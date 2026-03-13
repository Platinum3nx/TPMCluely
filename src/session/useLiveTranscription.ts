import { listen } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  getCaptureStatus,
  listSystemAudioSources,
  startSystemAudioCapture,
  stopSystemAudioCapture,
  updateBrowserCaptureSession,
} from "../lib/tauri";
import type {
  AudioInputDevice,
  BrowserCaptureSessionUpdateInput,
  CaptureHealthPayload,
  CapturePartialEventPayload,
  CaptureRuntimeState,
  CaptureSegmentEventPayload,
  CaptureStatePayload,
  CaptureMode,
  PreflightCheck,
  ScreenContextInput,
  ScreenShareState,
  StartSystemAudioCaptureInput,
  SystemAudioSource,
  SystemAudioSourceListPayload,
} from "../lib/types";

const KEEP_ALIVE_INTERVAL_MS = 8_000;
const FIRST_TRANSCRIPT_WARNING_MS = 12_000;
const MAX_SCREEN_CONTEXT_BYTES = 1_500_000;
const MAX_SCREEN_CONTEXT_STALE_MS = 5_000;
const MAX_SCREEN_LONG_EDGE = 1_440;
const MIN_SCREEN_WIDTH = 480;
const MIN_SCREEN_HEIGHT = 270;
const INITIAL_SCREEN_QUALITY = 0.82;
const MIN_SCREEN_QUALITY = 0.56;
const SCREEN_COMPRESSION_ATTEMPTS = 6;
const TRANSCRIPT_STALE_WARNING_MS = 20_000;
const MICROPHONE_RECONNECT_DELAYS_MS = [1_000, 2_500, 5_000];

type CaptureSegment = {
  speakerId?: string | null;
  speakerLabel?: string | null;
  speakerConfidence?: number | null;
  text: string;
  source: "capture";
};

interface StartCaptureOptions {
  apiKey?: string;
  deviceId?: string;
  language: string;
  mode: CaptureMode;
  sessionId?: string;
  source?: SystemAudioSource | null;
}

interface UseLiveTranscriptionOptions {
  onMicrophoneFinalTranscript: (segment: CaptureSegment) => Promise<void>;
  onNativeCaptureSegment: (payload: CaptureSegmentEventPayload) => void;
  onCaptureSessionStateChanged: (sessionId: string) => Promise<void>;
  preferredMicrophoneDeviceId?: string;
}

interface DeepgramResultsMessage {
  type?: string;
  speech_final?: boolean;
  is_final?: boolean;
  utterances?: DeepgramUtterance[];
  results?: {
    utterances?: DeepgramUtterance[];
  };
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      words?: DeepgramWord[];
      utterances?: DeepgramUtterance[];
    }>;
  };
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  speaker?: number;
  speaker_confidence?: number;
}

interface DeepgramUtterance {
  transcript?: string;
  start?: number;
  end?: number;
  speaker?: number;
  words?: DeepgramWord[];
}

type ScriptProcessorNodeLike = ScriptProcessorNode;
type BrowserCaptureSessionStatus = BrowserCaptureSessionUpdateInput["status"];

interface BrowserCaptureFailure {
  message: string;
  sessionStatus: BrowserCaptureSessionStatus;
}

interface MicrophoneProbeState {
  checkedAt: string | null;
  deviceId: string;
  check: PreflightCheck;
}

interface SystemAudioSourceCheckState {
  checkedAt: string | null;
  check: PreflightCheck;
}

const DEFAULT_MICROPHONE_PROBE_CHECK: PreflightCheck = {
  key: "microphone_stream_probe",
  title: "Microphone stream probe",
  status: "warning",
  message: "Run preflight or start listening to verify the selected microphone stream.",
};

const DEFAULT_SYSTEM_AUDIO_SOURCE_CHECK: PreflightCheck = {
  key: "system_audio_source_list",
  title: "Shareable system audio sources",
  status: "warning",
  message: "Run preflight or start listening to relist shareable system-audio sources before the meeting starts.",
};

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function toInt16Buffer(input: Float32Array): ArrayBuffer {
  const buffer = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    buffer[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return buffer.buffer;
}

function mapAudioLanguage(language: string): string | null {
  if (!language || language === "auto") {
    return null;
  }
  if (language === "en") {
    return "en-US";
  }
  if (language === "es") {
    return "es";
  }
  if (language === "fr") {
    return "fr";
  }
  return language;
}

function deepgramListenEndpoint(language: string, sampleRate: number): URL {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const endpoint = new URL(env?.VITE_DEEPGRAM_WS_URL ?? "wss://api.deepgram.com/v1/listen");
  endpoint.searchParams.set("encoding", "linear16");
  endpoint.searchParams.set("channels", "1");
  endpoint.searchParams.set("sample_rate", String(Math.round(sampleRate)));
  endpoint.searchParams.set("punctuate", "true");
  endpoint.searchParams.set("smart_format", "true");
  endpoint.searchParams.set("interim_results", "true");
  endpoint.searchParams.set("diarize", "true");
  endpoint.searchParams.set("utterances", "true");
  endpoint.searchParams.set("model", "nova-3");
  const mappedLanguage = mapAudioLanguage(language);
  if (mappedLanguage) {
    endpoint.searchParams.set("language", mappedLanguage);
  }
  return endpoint;
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function captureSegmentFingerprint(segment: CaptureSegment): string {
  return `${segment.speakerId ?? ""}:${normalizeTranscript(segment.text)}`;
}

function toSpeakerId(index: number | null | undefined): string | null {
  return typeof index === "number" && Number.isFinite(index) ? `dg:${index}` : null;
}

function toSpeakerLabel(index: number | null | undefined): string | null {
  return typeof index === "number" && Number.isFinite(index) ? `Speaker ${index + 1}` : null;
}

function wordToken(word: DeepgramWord): string {
  return (word.punctuated_word ?? word.word ?? "").trim();
}

function joinWordTokens(words: DeepgramWord[] | undefined): string {
  return (words ?? [])
    .map(wordToken)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function averageSpeakerConfidence(words: DeepgramWord[] | undefined): number | null {
  const values = (words ?? [])
    .map((word) => word.speaker_confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mergeCaptureSegments(buffer: CaptureSegment[], incoming: CaptureSegment[]): CaptureSegment[] {
  const merged = [...buffer];
  for (const segment of incoming) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }

    const previous = merged.at(-1);
    if (
      previous &&
      (previous.speakerId ?? null) === (segment.speakerId ?? null) &&
      (previous.speakerLabel ?? null) === (segment.speakerLabel ?? null)
    ) {
      previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim();
      previous.speakerConfidence =
        previous.speakerConfidence == null
          ? segment.speakerConfidence ?? null
          : segment.speakerConfidence == null
            ? previous.speakerConfidence
            : Math.min(previous.speakerConfidence, segment.speakerConfidence);
      continue;
    }

    merged.push({
      ...segment,
      text,
      speakerId: segment.speakerId ?? null,
      speakerLabel: segment.speakerLabel ?? null,
      speakerConfidence: segment.speakerConfidence ?? null,
    });
  }

  return merged;
}

function groupWordsBySpeaker(words: DeepgramWord[] | undefined): CaptureSegment[] {
  const grouped: CaptureSegment[] = [];
  for (const word of words ?? []) {
    const token = wordToken(word);
    if (!token) {
      continue;
    }

    const speakerId = toSpeakerId(word.speaker);
    const speakerLabel = toSpeakerLabel(word.speaker);
    const previous = grouped.at(-1);
    if (
      previous &&
      (previous.speakerId ?? null) === speakerId &&
      (previous.speakerLabel ?? null) === speakerLabel
    ) {
      previous.text = `${previous.text} ${token}`.replace(/\s+/g, " ").trim();
      previous.speakerConfidence =
        previous.speakerConfidence == null
          ? word.speaker_confidence ?? null
          : word.speaker_confidence == null
            ? previous.speakerConfidence
            : Math.min(previous.speakerConfidence, word.speaker_confidence);
      continue;
    }

    grouped.push({
      speakerId,
      speakerLabel,
      speakerConfidence: word.speaker_confidence ?? null,
      text: token,
      source: "capture",
    });
  }

  return grouped;
}

function normalizeDeepgramUtterance(utterance: DeepgramUtterance): CaptureSegment[] {
  if (typeof utterance.speaker === "number") {
    const text = utterance.transcript?.trim() || joinWordTokens(utterance.words);
    if (!text) {
      return [];
    }

    return [
      {
        speakerId: toSpeakerId(utterance.speaker),
        speakerLabel: toSpeakerLabel(utterance.speaker),
        speakerConfidence: averageSpeakerConfidence(utterance.words),
        text,
        source: "capture",
      },
    ];
  }

  if ((utterance.words ?? []).some((word) => typeof word.speaker === "number")) {
    return groupWordsBySpeaker(utterance.words);
  }

  const text = utterance.transcript?.trim() || joinWordTokens(utterance.words);
  if (!text) {
    return [];
  }

  return [
    {
      speakerId: null,
      speakerLabel: null,
      speakerConfidence: null,
      text,
      source: "capture",
    },
  ];
}

export function normalizeDeepgramFinalSegments(payload: DeepgramResultsMessage): CaptureSegment[] {
  const alternative = payload.channel?.alternatives?.[0];
  const transcript = alternative?.transcript?.trim() ?? "";
  const utterances =
    payload.utterances ??
    payload.results?.utterances ??
    alternative?.utterances ??
    [];

  if (utterances.length > 0) {
    return utterances.reduce<CaptureSegment[]>(
      (segments, utterance) => mergeCaptureSegments(segments, normalizeDeepgramUtterance(utterance)),
      []
    );
  }

  if ((alternative?.words?.length ?? 0) > 0) {
    return groupWordsBySpeaker(alternative?.words);
  }

  if (!transcript) {
    return [];
  }

  return [
    {
      speakerId: null,
      speakerLabel: null,
      speakerConfidence: null,
      text: transcript,
      source: "capture",
    },
  ];
}

function describeMicrophoneDevices(devices: MediaDeviceInfo[]): AudioInputDevice[] {
  const microphoneDevices = devices.filter((device) => device.kind === "audioinput");
  return microphoneDevices.map((device, index) => {
    const label = device.label?.trim();
    return {
      deviceId: device.deviceId,
      label: label && label.length > 0 ? label : `Microphone ${index + 1}`,
      isDefault: device.deviceId === "default" || /default/i.test(device.label ?? ""),
    };
  });
}

function microphoneDeviceCheck(
  devices: AudioInputDevice[],
  preferredDeviceId: string,
  selectedDeviceId: string
): PreflightCheck {
  if (preferredDeviceId && !devices.some((device) => device.deviceId === preferredDeviceId)) {
    return {
      key: "microphone_device_available",
      title: "Selected microphone",
      status: "blocked",
      message: "The saved preferred microphone is unavailable on this machine. Choose another input before the meeting starts.",
      detail: preferredDeviceId,
    };
  }

  if (selectedDeviceId && devices.some((device) => device.deviceId === selectedDeviceId)) {
    const selected = devices.find((device) => device.deviceId === selectedDeviceId);
    return {
      key: "microphone_device_available",
      title: "Selected microphone",
      status: "ready",
      message: `${selected?.label ?? "The selected microphone"} is available on this machine.`,
      detail: selectedDeviceId,
    };
  }

  if (devices.length === 0) {
    return {
      key: "microphone_device_available",
      title: "Selected microphone",
      status: "warning",
      message: "No microphone inputs are visible yet. TPMCluely can verify the default input during interactive preflight.",
    };
  }

  return {
    key: "microphone_device_available",
    title: "Selected microphone",
    status: "warning",
    message: "Select a microphone to let TPMCluely verify it before the meeting starts.",
  };
}

function mapMicrophoneFailure(error: unknown, requestedDeviceId: string): BrowserCaptureFailure {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError") {
      return {
        message:
          "Microphone permission was denied. Open System Settings -> Privacy & Security -> Microphone and enable TPMCluely before retrying.",
        sessionStatus: "permission_blocked",
      };
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError" ||
      error.name === "DevicesNotFoundError"
    ) {
      return {
        message: requestedDeviceId
          ? "The selected microphone is unavailable on this machine. Choose another input before the meeting starts."
          : "No working microphone input is available right now. Choose another input or switch TPMCluely to manual mode.",
        sessionStatus: "capture_error",
      };
    }

    if (error.name === "NotReadableError" || error.name === "AbortError" || error.name === "InvalidStateError") {
      return {
        message:
          "The selected microphone could not be opened cleanly. Close apps that may be holding the device, choose another input, or switch to manual mode.",
        sessionStatus: "capture_error",
      };
    }
  }

  return {
    message:
      error instanceof Error
        ? error.message
        : "Live transcription could not start with the current microphone setup.",
    sessionStatus: "capture_error",
  };
}

function summarizeTranscriptFreshness(captureState: CaptureRuntimeState, freshnessMs: number | null): string {
  if (captureState === "idle") {
    return "Idle";
  }
  if (captureState === "connecting" || captureState === "starting") {
    return "Connecting";
  }
  if (freshnessMs == null) {
    return "Waiting for first finalized transcript";
  }
  if (freshnessMs < 4_000) {
    return "Fresh";
  }
  if (freshnessMs < TRANSCRIPT_STALE_WARNING_MS) {
    return `${Math.round(freshnessMs / 1_000)}s since last finalized line`;
  }
  return `Stale (${Math.round(freshnessMs / 1_000)}s)`;
}

function buildSystemAudioSourceCheck(payload: SystemAudioSourceListPayload, interactive: boolean): PreflightCheck {
  if (payload.permissionStatus !== "granted") {
    return {
      key: "system_audio_source_list",
      title: "Shareable system audio sources",
      status: "blocked",
      message:
        payload.message ??
        "Screen Recording permission is required before TPMCluely can verify shareable system-audio sources.",
    };
  }

  if (!interactive) {
    return {
      key: "system_audio_source_list",
      title: "Shareable system audio sources",
      status: "warning",
      message: "Run preflight or start listening to relist shareable system-audio sources before the meeting starts.",
    };
  }

  if (payload.sources.length === 0) {
    return {
      key: "system_audio_source_list",
      title: "Shareable system audio sources",
      status: "blocked",
      message: "No shareable system-audio sources are available right now. Join the meeting, then retry or switch TPMCluely to microphone/manual mode.",
    };
  }

  return {
    key: "system_audio_source_list",
    title: "Shareable system audio sources",
    status: "ready",
    message: "Shareable system-audio sources are available. Choose one when TPMCluely starts listening.",
    detail: String(payload.sources.length),
  };
}

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

function ensureFrameElements(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
) {
  if (!videoRef.current) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = false;
    videoRef.current = video;
  }

  if (!canvasRef.current) {
    canvasRef.current = document.createElement("canvas");
  }

  return {
    video: videoRef.current,
    canvas: canvasRef.current,
  };
}

async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Shared screen video is not ready yet."));
    }, 2_000);

    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Shared screen video could not be read."));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("canplay", onLoaded);
    video.addEventListener("error", onError);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Screen frame could not be read."));
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const [, payload = ""] = value.split(",", 2);
      resolve(payload);
    };
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Screen frame could not be encoded."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function describeDisplaySource(stream: MediaStream | null): string {
  const track = stream?.getVideoTracks()[0];
  const label = track?.label?.trim();
  return label && label.length > 0 ? label : "Shared screen";
}

function normalizeCaptureState(state: CaptureRuntimeState): CaptureRuntimeState {
  return state;
}

export function resolvePendingMicrophoneTranscript(interimTranscript: string, lastFinalTranscript: string): string | null {
  const normalizedInterim = interimTranscript.trim();
  if (!normalizedInterim || normalizedInterim === lastFinalTranscript.trim()) {
    return null;
  }

  return normalizedInterim;
}

export function useLiveTranscription({
  onMicrophoneFinalTranscript,
  onNativeCaptureSegment,
  onCaptureSessionStateChanged,
  preferredMicrophoneDeviceId = "",
}: UseLiveTranscriptionOptions) {
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [captureState, setCaptureState] = useState<CaptureRuntimeState>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureHealth, setCaptureHealth] = useState<CaptureHealthPayload | null>(null);
  const [captureSourceLabel, setCaptureSourceLabel] = useState<string | null>(null);
  const [lastTranscriptFinalizedAt, setLastTranscriptFinalizedAt] = useState<string | null>(null);
  const [microphoneSelectionWarning, setMicrophoneSelectionWarning] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceIdState] = useState("");
  const [microphoneProbeState, setMicrophoneProbeState] = useState<MicrophoneProbeState>({
    checkedAt: null,
    deviceId: "",
    check: DEFAULT_MICROPHONE_PROBE_CHECK,
  });
  const [systemAudioSourceCheckState, setSystemAudioSourceCheckState] = useState<SystemAudioSourceCheckState>({
    checkedAt: null,
    check: DEFAULT_SYSTEM_AUDIO_SOURCE_CHECK,
  });
  const [screenShareState, setScreenShareState] = useState<ScreenShareState>("inactive");
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [screenShareOwnedByCapture] = useState(false);

  const activeModeRef = useRef<CaptureMode>("manual");
  const activeNativeSessionIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNodeLike | null>(null);
  const silenceNodeRef = useRef<GainNode | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const captureStateRef = useRef<CaptureRuntimeState>("idle");
  const pendingInterimTranscriptRef = useRef("");
  const pendingFinalSegmentsRef = useRef<CaptureSegment[]>([]);
  const lastFinalSegmentFingerprintRef = useRef("");
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const screenContextCacheRef = useRef<ScreenContextInput | null>(null);
  const browserCaptureOptionsRef = useRef<StartCaptureOptions | null>(null);
  const listeningStartedAtRef = useRef<number | null>(null);
  const lastTranscriptFinalizedAtRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const selectedMicrophoneDeviceIdRef = useRef("");
  const microphoneProbeStateRef = useRef<MicrophoneProbeState>({
    checkedAt: null,
    deviceId: "",
    check: DEFAULT_MICROPHONE_PROBE_CHECK,
  });
  const systemAudioSourceCheckStateRef = useRef<SystemAudioSourceCheckState>({
    checkedAt: null,
    check: DEFAULT_SYSTEM_AUDIO_SOURCE_CHECK,
  });

  const clearReconnectTimer = useEffectEvent(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  });

  const updateSelectedMicrophoneDevice = useEffectEvent((deviceId: string) => {
    selectedMicrophoneDeviceIdRef.current = deviceId;
    setSelectedMicrophoneDeviceIdState(deviceId);
    const warningCheck: PreflightCheck = {
      ...DEFAULT_MICROPHONE_PROBE_CHECK,
      message: deviceId
        ? "Run preflight or start listening to verify the newly selected microphone stream."
        : DEFAULT_MICROPHONE_PROBE_CHECK.message,
    };
    const nextProbeState: MicrophoneProbeState = {
      checkedAt: null,
      deviceId,
      check: warningCheck,
    };
    microphoneProbeStateRef.current = nextProbeState;
    setMicrophoneProbeState(nextProbeState);
  });

  const persistBrowserSessionStatus = useEffectEvent(
    async (
      sessionId: string | undefined,
      status: BrowserCaptureSessionStatus,
      overrides: Partial<Pick<BrowserCaptureSessionUpdateInput, "captureMode" | "captureTargetKind" | "captureTargetLabel">> = {}
    ) => {
      if (!sessionId) {
        return;
      }

      await updateBrowserCaptureSession({
        sessionId,
        status,
        captureMode: overrides.captureMode,
        captureTargetKind: overrides.captureTargetKind,
        captureTargetLabel: overrides.captureTargetLabel,
      }).catch(() => undefined);
      await onCaptureSessionStateChanged(sessionId).catch(() => undefined);
    }
  );

  const recordFinalizedTranscript = useEffectEvent(() => {
    const now = Date.now();
    lastTranscriptFinalizedAtRef.current = now;
    setLastTranscriptFinalizedAt(new Date(now).toISOString());
    if (activeModeRef.current === "microphone") {
      setCaptureHealth(null);
      if (captureStateRef.current === "degraded") {
        captureStateRef.current = "listening";
        setCaptureState("listening");
      }
    }
  });

  const refreshAudioInputDevices = useEffectEvent(async (): Promise<AudioInputDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([]);
      return [];
    }

    try {
      const devices = describeMicrophoneDevices(await navigator.mediaDevices.enumerateDevices());
      setAudioInputDevices(devices);

      const preferredDeviceId = preferredMicrophoneDeviceId.trim();
      const currentDeviceId = selectedMicrophoneDeviceIdRef.current.trim();
      const nextSelectedDeviceId =
        devices.find((device) => device.deviceId === currentDeviceId)?.deviceId ??
        devices.find((device) => device.deviceId === preferredDeviceId)?.deviceId ??
        devices.find((device) => device.isDefault)?.deviceId ??
        devices[0]?.deviceId ??
        "";

      updateSelectedMicrophoneDevice(nextSelectedDeviceId);

      if (preferredDeviceId && !devices.some((device) => device.deviceId === preferredDeviceId)) {
        setMicrophoneSelectionWarning(
          "The saved preferred microphone is unavailable on this machine. Pick another input before the meeting starts."
        );
      } else if (!preferredDeviceId && nextSelectedDeviceId) {
        setMicrophoneSelectionWarning(
          "No preferred microphone is saved yet. Pick the input you want TPMCluely to reuse for future meetings."
        );
      } else if (devices.length === 0) {
        setMicrophoneSelectionWarning(
          "No microphone inputs are visible yet. TPMCluely will request the default input when you start listening."
        );
      } else {
        setMicrophoneSelectionWarning(null);
      }
      return devices;
    } catch {
      setAudioInputDevices([]);
      return [];
    }
  });

  const probeSelectedMicrophone = useEffectEvent(async (deviceId: string): Promise<PreflightCheck> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        key: "microphone_stream_probe",
        title: "Microphone stream probe",
        status: "blocked",
        message: "Audio capture is unavailable in this runtime, so TPMCluely cannot verify microphone startup.",
      };
    }

    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const check: PreflightCheck = {
        key: "microphone_stream_probe",
        title: "Microphone stream probe",
        status: "ready",
        message: "The selected microphone opened successfully and can stream audio.",
        detail: deviceId || null,
      };
      const nextProbeState: MicrophoneProbeState = {
        checkedAt: new Date().toISOString(),
        deviceId,
        check,
      };
      microphoneProbeStateRef.current = nextProbeState;
      setMicrophoneProbeState(nextProbeState);
      return check;
    } catch (error) {
      const failure = mapMicrophoneFailure(error, deviceId);
      const check: PreflightCheck = {
        key: "microphone_stream_probe",
        title: "Microphone stream probe",
        status: "blocked",
        message: failure.message,
        detail: deviceId || null,
      };
      const nextProbeState: MicrophoneProbeState = {
        checkedAt: new Date().toISOString(),
        deviceId,
        check,
      };
      microphoneProbeStateRef.current = nextProbeState;
      setMicrophoneProbeState(nextProbeState);
      return check;
    } finally {
      stopMediaStream(stream);
    }
  });

  const collectMicrophonePreflightChecks = useEffectEvent(
    async (interactive = false): Promise<PreflightCheck[]> => {
      const devices = await refreshAudioInputDevices();
      const preferredDeviceId = preferredMicrophoneDeviceId.trim();
      const selectedDeviceId =
        selectedMicrophoneDeviceIdRef.current.trim() ||
        devices.find((device) => device.deviceId === preferredDeviceId)?.deviceId ||
        devices.find((device) => device.isDefault)?.deviceId ||
        devices[0]?.deviceId ||
        "";
      const deviceCheck = microphoneDeviceCheck(devices, preferredDeviceId, selectedDeviceId);

      if (!interactive) {
        const cachedProbe =
          microphoneProbeStateRef.current.deviceId === selectedDeviceId
            ? microphoneProbeStateRef.current.check
            : DEFAULT_MICROPHONE_PROBE_CHECK;
        return [deviceCheck, cachedProbe];
      }

      const probeCheck =
        deviceCheck.status === "blocked" ? DEFAULT_MICROPHONE_PROBE_CHECK : await probeSelectedMicrophone(selectedDeviceId);
      return [deviceCheck, probeCheck];
    }
  );

  const collectSystemAudioPreflightCheck = useEffectEvent(
    async (interactive = false): Promise<PreflightCheck> => {
      if (!interactive) {
        return systemAudioSourceCheckStateRef.current.check;
      }

      const payload = await listAvailableSystemAudioSources({ suppressCaptureError: false });
      const nextCheck = buildSystemAudioSourceCheck(payload, true);
      const nextState: SystemAudioSourceCheckState = {
        checkedAt: new Date().toISOString(),
        check: nextCheck,
      };
      systemAudioSourceCheckStateRef.current = nextState;
      setSystemAudioSourceCheckState(nextState);
      return nextCheck;
    }
  );

  const applyNativeCaptureState = useEffectEvent((payload: CaptureStatePayload) => {
    const nextState = normalizeCaptureState(payload.runtimeState);
    captureStateRef.current = nextState;
    setCaptureState(nextState);
    setCaptureSourceLabel(payload.sourceLabel ?? null);
    activeNativeSessionIdRef.current = payload.sessionId ?? activeNativeSessionIdRef.current;

    if (nextState === "listening" || nextState === "connecting" || nextState === "starting") {
      setCaptureError(null);
      return;
    }

    if (nextState === "idle") {
      setCaptureError(null);
      setCaptureHealth(null);
      setCaptureSourceLabel(null);
      setLastTranscriptFinalizedAt(null);
      lastTranscriptFinalizedAtRef.current = null;
      listeningStartedAtRef.current = null;
      activeNativeSessionIdRef.current = null;
      return;
    }

    if (payload.message) {
      setCaptureError(payload.message);
    }
  });

  useEffect(() => {
    void refreshAudioInputDevices();
  }, [preferredMicrophoneDeviceId, refreshAudioInputDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const handleDeviceChange = () => {
      const nextProbeState: MicrophoneProbeState = {
        checkedAt: null,
        deviceId: selectedMicrophoneDeviceIdRef.current.trim(),
        check: {
          ...DEFAULT_MICROPHONE_PROBE_CHECK,
          message: "Microphone devices changed. Run preflight again before TPMCluely starts listening.",
        },
      };
      microphoneProbeStateRef.current = nextProbeState;
      setMicrophoneProbeState(nextProbeState);
      void refreshAudioInputDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshAudioInputDevices]);

  const handleMicrophoneFinalTranscript = useEffectEvent(async (segment: CaptureSegment) => {
    recordFinalizedTranscript();
    await onMicrophoneFinalTranscript(segment);
  });

  const resetScreenContextCache = useEffectEvent(() => {
    screenContextCacheRef.current = null;
  });

  const clearDisplayStream = useEffectEvent(async (stopTracks: boolean) => {
    const displayStream = displayStreamRef.current;
    displayStreamRef.current = null;
    resetScreenContextCache();

    if (videoElementRef.current) {
      videoElementRef.current.pause();
      videoElementRef.current.srcObject = null;
    }

    if (stopTracks) {
      stopMediaStream(displayStream);
    } else if (displayStream) {
      for (const track of displayStream.getTracks()) {
        track.onended = null;
      }
    }

    setScreenShareState("inactive");
  });

  const handleDisplayTrackEnded = useEffectEvent(async () => {
    resetScreenContextCache();
    await clearDisplayStream(false);
    setScreenShareState("error");
    setScreenShareError("Screen sharing ended. Ask TPMCluely will fall back to transcript-only answers.");
  });

  const attachDisplayStream = useEffectEvent(async (stream: MediaStream) => {
    if (displayStreamRef.current && displayStreamRef.current !== stream) {
      await clearDisplayStream(true);
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      setScreenShareState("inactive");
      return;
    }

    const { video } = ensureFrameElements(videoElementRef, canvasElementRef);
    displayStreamRef.current = stream;
    videoTrack.onended = () => {
      void handleDisplayTrackEnded();
    };

    video.srcObject = stream;
    await video.play().catch(() => undefined);
    setScreenShareError(null);
    setScreenShareState("active");
  });

  function teardownAudioGraph() {
    processorNodeRef.current?.disconnect();
    silenceNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();

    processorNodeRef.current = null;
    silenceNodeRef.current = null;
    sourceNodeRef.current = null;
  }

  const stopScreenShare = useEffectEvent(async () => {
    await clearDisplayStream(true);
    setScreenShareError(null);
  });

  const flushPendingBrowserSegments = useEffectEvent(async () => {
    const segments = pendingFinalSegmentsRef.current;
    pendingFinalSegmentsRef.current = [];
    pendingInterimTranscriptRef.current = "";
    setPartialTranscript("");

    for (const segment of segments) {
      const fingerprint = captureSegmentFingerprint(segment);
      if (!segment.text.trim() || fingerprint === lastFinalSegmentFingerprintRef.current) {
        continue;
      }
      lastFinalSegmentFingerprintRef.current = fingerprint;
      await handleMicrophoneFinalTranscript(segment);
    }
  });

  const stopBrowserMicrophoneCapture = useEffectEvent(async () => {
    if (captureStateRef.current !== "idle") {
      captureStateRef.current = "stopping";
      setCaptureState("stopping");
    }

    clearReconnectTimer();
    await flushPendingBrowserSegments();

    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }

    if (websocketRef.current) {
      if (websocketRef.current.readyState === WebSocket.OPEN) {
        websocketRef.current.send(JSON.stringify({ type: "CloseStream" }));
      }
      websocketRef.current.close();
      websocketRef.current = null;
    }

    teardownAudioGraph();

    const audioStream = audioStreamRef.current;
    audioStreamRef.current = null;
    stopMediaStream(audioStream);

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    captureStateRef.current = "idle";
    setCaptureState("idle");
    setCaptureError(null);
    setCaptureHealth(null);
    setCaptureSourceLabel(null);
    setLastTranscriptFinalizedAt(null);
    lastTranscriptFinalizedAtRef.current = null;
    listeningStartedAtRef.current = null;
    pendingInterimTranscriptRef.current = "";
    pendingFinalSegmentsRef.current = [];
    lastFinalSegmentFingerprintRef.current = "";
    browserCaptureOptionsRef.current = null;
    reconnectAttemptRef.current = 0;
  });

  const scheduleBrowserReconnect = useEffectEvent((reason: string) => {
    const options = browserCaptureOptionsRef.current;
    if (activeModeRef.current !== "microphone" || !options) {
      return false;
    }

    const nextAttempt = reconnectAttemptRef.current + 1;
    const delayMs = MICROPHONE_RECONNECT_DELAYS_MS[nextAttempt - 1];
    if (!delayMs) {
      return false;
    }

    reconnectAttemptRef.current = nextAttempt;
    clearReconnectTimer();
    captureStateRef.current = "degraded";
    setCaptureState("degraded");
    setCaptureError(
      `${reason} Reconnecting in ${Math.max(1, Math.round(delayMs / 1_000))}s (${nextAttempt}/${MICROPHONE_RECONNECT_DELAYS_MS.length}).`
    );
    setCaptureHealth({
      sessionId: options.sessionId ?? null,
      severity: "warning",
      droppedFrames: 0,
      queueDepth: 0,
      reconnectAttempt: nextAttempt,
      message: "Live transcription dropped. TPMCluely is reconnecting the microphone stream.",
    });
    void persistBrowserSessionStatus(options.sessionId, "provider_degraded", {
      captureMode: "microphone",
    });

    reconnectTimerRef.current = window.setTimeout(() => {
      const reconnectOptions = browserCaptureOptionsRef.current;
      if (!reconnectOptions || activeModeRef.current !== "microphone") {
        return;
      }
      void startBrowserMicrophoneCapture(reconnectOptions);
    }, delayMs);

    return true;
  });

  const startBrowserMicrophoneCapture = useEffectEvent(
    async ({ apiKey, deviceId, language, sessionId }: StartCaptureOptions) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCaptureError("Audio capture is not available in this runtime.");
        setCaptureState("unsupported");
        captureStateRef.current = "unsupported";
        void persistBrowserSessionStatus(sessionId, "capture_error", {
          captureMode: "microphone",
        });
        return;
      }

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        setCaptureError("AudioContext is unavailable, so live transcription cannot start.");
        setCaptureState("unsupported");
        captureStateRef.current = "unsupported";
        void persistBrowserSessionStatus(sessionId, "capture_error", {
          captureMode: "microphone",
        });
        return;
      }

      if (!apiKey) {
        throw new Error("Add a Deepgram API key from Onboarding to enable live transcription.");
      }

      try {
        clearReconnectTimer();
        browserCaptureOptionsRef.current = {
          apiKey,
          deviceId,
          language,
          mode: "microphone",
          sessionId,
        };
        pendingInterimTranscriptRef.current = "";
        pendingFinalSegmentsRef.current = [];
        lastFinalSegmentFingerprintRef.current = "";
        lastTranscriptFinalizedAtRef.current = null;
        setLastTranscriptFinalizedAt(null);
        setCaptureError(null);
        setCaptureHealth(null);
        setCaptureState("connecting");
        captureStateRef.current = "connecting";
        listeningStartedAtRef.current = Date.now();

        const selectedDeviceId = deviceId?.trim() || selectedMicrophoneDeviceIdRef.current.trim();
        const audioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (selectedDeviceId) {
          audioConstraints.deviceId = { exact: selectedDeviceId };
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });

        if (mediaStream.getAudioTracks().length === 0) {
          throw new Error("The selected microphone stream did not provide any audio tracks.");
        }
        audioStreamRef.current = mediaStream;
        await refreshAudioInputDevices();

        const audioContext = new AudioContextCtor();
        audioContextRef.current = audioContext;
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => undefined);
        }

        const endpoint = deepgramListenEndpoint(language, audioContext.sampleRate);
        const websocket = new WebSocket(endpoint, ["token", apiKey]);
        websocket.binaryType = "arraybuffer";
        websocketRef.current = websocket;

        const audioTrack = mediaStream.getAudioTracks()[0];
        audioTrack.onended = () => {
          if (captureStateRef.current === "stopping" || activeModeRef.current !== "microphone") {
            return;
          }
          void stopMediaStream(mediaStream);
          audioStreamRef.current = null;
          if (!scheduleBrowserReconnect("The microphone stream ended unexpectedly.")) {
            setCaptureError("The microphone stream ended unexpectedly. Start listening again.");
            setCaptureState("error");
            captureStateRef.current = "error";
            void persistBrowserSessionStatus(sessionId, "capture_error", {
              captureMode: "microphone",
            });
          }
        };

        websocket.onmessage = (event) => {
          if (typeof event.data !== "string") {
            return;
          }

          let payload: DeepgramResultsMessage;
          try {
            payload = JSON.parse(event.data) as DeepgramResultsMessage;
          } catch {
            return;
          }

          if (payload.type === "UtteranceEnd") {
            void flushPendingBrowserSegments();
            return;
          }

          if (payload.type !== "Results") {
            return;
          }

          const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim() ?? "";

          if (payload.is_final) {
            const finalizedSegments = normalizeDeepgramFinalSegments(payload);
            if (finalizedSegments.length > 0) {
              pendingFinalSegmentsRef.current = mergeCaptureSegments(
                pendingFinalSegmentsRef.current,
                finalizedSegments
              );
            }
            pendingInterimTranscriptRef.current = "";
            setPartialTranscript("");

            if (payload.speech_final || (!transcript && finalizedSegments.length === 0)) {
              void flushPendingBrowserSegments();
            }
            return;
          }

          pendingInterimTranscriptRef.current = transcript;
          setPartialTranscript(transcript);
        };

        websocket.onerror = () => {
          if (captureStateRef.current !== "stopping") {
            setCaptureError("Deepgram live transcription connection dropped.");
          }
        };

        websocket.onclose = () => {
          void flushPendingBrowserSegments();
          websocketRef.current = null;
          if (keepAliveRef.current !== null) {
            window.clearInterval(keepAliveRef.current);
            keepAliveRef.current = null;
          }
          teardownAudioGraph();
          if (captureStateRef.current === "stopping") {
            return;
          }
          if (audioStreamRef.current) {
            stopMediaStream(audioStreamRef.current);
            audioStreamRef.current = null;
          }
          if (audioContextRef.current) {
            void audioContextRef.current.close().catch(() => undefined);
            audioContextRef.current = null;
          }
          if (
            captureStateRef.current === "listening" ||
            captureStateRef.current === "connecting" ||
            captureStateRef.current === "degraded"
          ) {
            if (!scheduleBrowserReconnect("Live transcription disconnected.")) {
              setCaptureError("Live transcription disconnected. You can start it again.");
              setCaptureState("error");
              captureStateRef.current = "error";
              void persistBrowserSessionStatus(sessionId, "capture_error", {
                captureMode: "microphone",
              });
            }
          }
        };

        websocket.onopen = () => {
          const sourceNode = audioContext.createMediaStreamSource(mediaStream);
          const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
          const silenceNode = audioContext.createGain();
          silenceNode.gain.value = 0;

          sourceNode.connect(processorNode);
          processorNode.connect(silenceNode);
          silenceNode.connect(audioContext.destination);

          processorNode.onaudioprocess = (event) => {
            if (websocket.readyState !== WebSocket.OPEN) {
              return;
            }

            const samples = event.inputBuffer.getChannelData(0);
            websocket.send(toInt16Buffer(samples));
          };

          sourceNodeRef.current = sourceNode;
          processorNodeRef.current = processorNode;
          silenceNodeRef.current = silenceNode;
          reconnectAttemptRef.current = 0;

          keepAliveRef.current = window.setInterval(() => {
            if (websocket.readyState === WebSocket.OPEN) {
              websocket.send(JSON.stringify({ type: "KeepAlive" }));
            }
          }, KEEP_ALIVE_INTERVAL_MS);

          setCaptureState("listening");
          captureStateRef.current = "listening";
          setCaptureError(null);
          setCaptureHealth(null);
          setCaptureSourceLabel(audioTrack.label?.trim() || "Microphone");
          void persistBrowserSessionStatus(sessionId, "active", {
            captureMode: "microphone",
          });
        };
      } catch (error) {
        const reconnectOptions = browserCaptureOptionsRef.current;
        await stopBrowserMicrophoneCapture();
        browserCaptureOptionsRef.current = reconnectOptions;
        const failure = mapMicrophoneFailure(error, deviceId?.trim() || selectedMicrophoneDeviceIdRef.current.trim());
        if (!scheduleBrowserReconnect(failure.message)) {
          setCaptureError(failure.message);
          setCaptureState("error");
          captureStateRef.current = "error";
          await persistBrowserSessionStatus(sessionId, failure.sessionStatus, {
            captureMode: "microphone",
          });
        }
      }
    }
  );

  const stopCapture = useEffectEvent(async (sessionId?: string) => {
    if (activeModeRef.current === "system_audio" && isTauriRuntime()) {
      const targetSessionId = sessionId ?? activeNativeSessionIdRef.current;
      if (targetSessionId) {
        const payload = await stopSystemAudioCapture(targetSessionId);
        applyNativeCaptureState(payload);
      } else {
        applyNativeCaptureState({
          sessionId: null,
          runtimeState: "idle",
          captureMode: "manual",
          sourceLabel: null,
          message: null,
          permissionStatus: null,
          targetKind: null,
          reconnectAttempt: 0,
        });
      }
      activeModeRef.current = "manual";
      setPartialTranscript("");
      return;
    }

    await stopBrowserMicrophoneCapture();
    activeModeRef.current = "manual";
  });

  const listAvailableSystemAudioSources = useEffectEvent(
    async ({ suppressCaptureError = false }: { suppressCaptureError?: boolean } = {}): Promise<SystemAudioSourceListPayload> => {
    const payload = await listSystemAudioSources();
    if (!suppressCaptureError && payload.permissionStatus !== "granted") {
      setCaptureError(
        payload.message ??
          "Screen Recording permission is required before TPMCluely can capture system audio."
      );
    } else if (!suppressCaptureError) {
      setCaptureError(null);
    }
    return payload;
    }
  );

  const startCapture = useEffectEvent(async (options: StartCaptureOptions) => {
    if (options.mode === "manual") {
      setCaptureError("Set capture mode to microphone or system audio to start live transcription.");
      setCaptureState("error");
      captureStateRef.current = "error";
      return;
    }

    await stopCapture(options.sessionId);

    if (options.mode === "system_audio") {
      if (!options.sessionId || !options.source) {
        throw new Error("Choose a system audio source before starting native capture.");
      }

      const input: StartSystemAudioCaptureInput = {
        sessionId: options.sessionId,
        sourceId: options.source.id,
        sourceKind: options.source.kind,
        sourceLabel: options.source.sourceLabel,
      };
      activeModeRef.current = "system_audio";
      const payload = await startSystemAudioCapture(input);
      applyNativeCaptureState(payload);
      return;
    }

    activeModeRef.current = "microphone";
    await startBrowserMicrophoneCapture(options);
  });

  const startScreenShare = useEffectEvent(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareError("Screen sharing is not available in this runtime.");
      setScreenShareState("error");
      return false;
    }

    try {
      setScreenShareError(null);
      setScreenShareState("requesting");
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      await attachDisplayStream(displayStream);
      return true;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Screen sharing was cancelled. TPMCluely will keep using transcript-only answers."
          : error instanceof Error
            ? error.message
            : "Screen sharing could not start.";
      setScreenShareError(message);
      setScreenShareState("error");
      return false;
    }
  });

  const captureScreenContext = useEffectEvent(async (): Promise<ScreenContextInput | null> => {
    const displayStream = displayStreamRef.current;
    if (!displayStream || screenShareState !== "active") {
      return null;
    }

    const cached = screenContextCacheRef.current;
    const now = Date.now();
    try {
      const { video, canvas } = ensureFrameElements(videoElementRef, canvasElementRef);
      video.srcObject = displayStream;
      await video.play().catch(() => undefined);
      await waitForVideoFrame(video);

      const naturalWidth = video.videoWidth;
      const naturalHeight = video.videoHeight;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        throw new Error("Shared screen frame is unavailable.");
      }

      const longestEdge = Math.max(naturalWidth, naturalHeight);
      const scale = Math.min(1, MAX_SCREEN_LONG_EDGE / longestEdge);
      let targetWidth = Math.max(MIN_SCREEN_WIDTH, Math.round(naturalWidth * scale));
      let targetHeight = Math.max(MIN_SCREEN_HEIGHT, Math.round(naturalHeight * scale));
      let quality = INITIAL_SCREEN_QUALITY;

      let blob: Blob | null = null;

      for (let attempt = 0; attempt < SCREEN_COMPRESSION_ATTEMPTS; attempt += 1) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context is unavailable for screen capture.");
        }

        context.drawImage(video, 0, 0, targetWidth, targetHeight);
        blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob.size <= MAX_SCREEN_CONTEXT_BYTES) {
          break;
        }

        const shrinkFactor = Math.max(
          0.7,
          Math.min(0.92, Math.sqrt(MAX_SCREEN_CONTEXT_BYTES / blob.size) * 0.95)
        );
        targetWidth = Math.max(MIN_SCREEN_WIDTH, Math.round(targetWidth * shrinkFactor));
        targetHeight = Math.max(MIN_SCREEN_HEIGHT, Math.round(targetHeight * shrinkFactor));
        quality = Math.max(MIN_SCREEN_QUALITY, quality - 0.06);
      }

      if (!blob) {
        throw new Error("Screen frame could not be encoded.");
      }

      const capturedAt = new Date(now).toISOString();
      const screenContext: ScreenContextInput = {
        mimeType: blob.type || "image/jpeg",
        dataBase64: await blobToBase64(blob),
        capturedAt,
        width: targetWidth,
        height: targetHeight,
        sourceLabel: describeDisplaySource(displayStream),
        staleMs: 0,
      };

      screenContextCacheRef.current = screenContext;
      setScreenShareError(null);
      return screenContext;
    } catch (error) {
      const cachedAge = cached ? now - Date.parse(cached.capturedAt) : Number.POSITIVE_INFINITY;
      if (cached && cachedAge <= MAX_SCREEN_CONTEXT_STALE_MS) {
        return {
          ...cached,
          staleMs: cachedAge,
        };
      }

      setScreenShareError(
        error instanceof Error
          ? `${error.message} TPMCluely will answer from transcript only until screen sharing is healthy again.`
          : "Shared screen is unavailable. TPMCluely will answer from transcript only."
      );
      return null;
    }
  });

  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }

    let disposed = false;
    let unlistenFns: Array<() => void> = [];

    void Promise.all([
      listen<CaptureStatePayload>("capture:state", (event) => {
        if (!disposed) {
          applyNativeCaptureState(event.payload);
          if (event.payload.sessionId) {
            void onCaptureSessionStateChanged(event.payload.sessionId);
          }
        }
      }),
      listen<CapturePartialEventPayload>("capture:partial", (event) => {
        if (!disposed) {
          setPartialTranscript(event.payload.text);
        }
      }),
      listen<CaptureSegmentEventPayload>("capture:segment", (event) => {
        if (!disposed) {
          setPartialTranscript("");
          recordFinalizedTranscript();
          onNativeCaptureSegment(event.payload);
        }
      }),
      listen<CaptureHealthPayload>("capture:health", (event) => {
        if (!disposed) {
          setCaptureHealth(event.payload);
          if (event.payload.severity !== "info") {
            setCaptureError(event.payload.message);
          }
        }
      }),
    ])
      .then((unlisteners) => {
        unlistenFns = unlisteners;
      })
      .catch(() => undefined);

    void getCaptureStatus("")
      .then((payload) => {
        if (!disposed) {
          applyNativeCaptureState(payload);
          if (payload.sessionId) {
            void onCaptureSessionStateChanged(payload.sessionId);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const unlistenFn of unlistenFns) {
        unlistenFn();
      }
    };
  }, [applyNativeCaptureState, onCaptureSessionStateChanged, onNativeCaptureSegment, recordFinalizedTranscript]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!["connecting", "listening", "degraded", "starting"].includes(captureStateRef.current)) {
        return;
      }

      const baseTimestamp = lastTranscriptFinalizedAtRef.current ?? listeningStartedAtRef.current;
      if (!baseTimestamp || activeModeRef.current !== "microphone") {
        return;
      }

      const freshnessMs = Date.now() - baseTimestamp;
      const waitingForFirstTranscript = lastTranscriptFinalizedAtRef.current == null;
      if (
        (waitingForFirstTranscript && freshnessMs >= FIRST_TRANSCRIPT_WARNING_MS) ||
        freshnessMs >= TRANSCRIPT_STALE_WARNING_MS
      ) {
        setCaptureHealth({
          sessionId: browserCaptureOptionsRef.current?.sessionId ?? null,
          severity: "warning",
          droppedFrames: 0,
          queueDepth: 0,
          reconnectAttempt: reconnectAttemptRef.current,
          message: waitingForFirstTranscript
            ? "Listening, but the first finalized transcript has not landed yet."
            : "Transcript has gone stale. Check the selected microphone or restart listening.",
        });
      } else if (captureStateRef.current === "listening") {
        setCaptureHealth(null);
      }
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    return () => {
      void stopCapture();
      void stopScreenShare();
    };
  }, [stopCapture, stopScreenShare]);

  const currentSelectedMicrophoneDeviceId =
    selectedMicrophoneDeviceIdRef.current.trim() ||
    audioInputDevices.find((device) => device.deviceId === preferredMicrophoneDeviceId.trim())?.deviceId ||
    audioInputDevices.find((device) => device.isDefault)?.deviceId ||
    audioInputDevices[0]?.deviceId ||
    "";
  const microphonePreflightChecks = [
    microphoneDeviceCheck(audioInputDevices, preferredMicrophoneDeviceId.trim(), currentSelectedMicrophoneDeviceId),
    microphoneProbeState.check,
  ];
  const systemAudioPreflightCheck = systemAudioSourceCheckState.check;

  return {
    audioInputDevices,
    captureError,
    captureHealth,
    captureSourceLabel,
    captureState,
    collectMicrophonePreflightChecks,
    collectSystemAudioPreflightCheck,
    lastTranscriptFinalizedAt,
    isCapturing: ["starting", "connecting", "listening", "degraded", "stopping"].includes(captureState),
    listAvailableSystemAudioSources,
    microphoneProbeCheck: microphoneProbeState.check,
    microphonePreflightChecks,
    microphoneSelectionWarning,
    partialTranscript,
    refreshAudioInputDevices,
    screenShareError,
    screenShareOwnedByCapture,
    screenShareState,
    selectedMicrophoneDeviceId,
    setSelectedMicrophoneDeviceId: updateSelectedMicrophoneDevice,
    startCapture,
    startScreenShare,
    stopCapture,
    stopScreenShare,
    systemAudioPreflightCheck,
    captureScreenContext,
    transcriptFreshnessLabel: summarizeTranscriptFreshness(
      captureState,
      lastTranscriptFinalizedAt
        ? Math.max(0, Date.now() - Date.parse(lastTranscriptFinalizedAt))
        : listeningStartedAtRef.current
          ? Math.max(0, Date.now() - listeningStartedAtRef.current)
          : null
    ),
  };
}
