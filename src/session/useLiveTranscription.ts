import { listen } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  getCaptureStatus,
  listSystemAudioSources,
  startSystemAudioCapture,
  stopSystemAudioCapture,
} from "../lib/tauri";
import type {
  CaptureHealthPayload,
  CapturePartialEventPayload,
  CaptureRuntimeState,
  CaptureSegmentEventPayload,
  CaptureStatePayload,
  CaptureMode,
  ScreenContextInput,
  ScreenShareState,
  StartSystemAudioCaptureInput,
  SystemAudioSource,
  SystemAudioSourceListPayload,
} from "../lib/types";

const KEEP_ALIVE_INTERVAL_MS = 8_000;
const MAX_SCREEN_CONTEXT_BYTES = 1_500_000;
const MAX_SCREEN_CONTEXT_STALE_MS = 5_000;
const MAX_SCREEN_LONG_EDGE = 1_440;
const MIN_SCREEN_WIDTH = 480;
const MIN_SCREEN_HEIGHT = 270;
const INITIAL_SCREEN_QUALITY = 0.82;
const MIN_SCREEN_QUALITY = 0.56;
const SCREEN_COMPRESSION_ATTEMPTS = 6;

type CaptureSegment = {
  speakerLabel?: string;
  text: string;
  source: "capture";
};

interface StartCaptureOptions {
  apiKey?: string;
  language: string;
  mode: CaptureMode;
  speakerLabel?: string;
  sessionId?: string;
  source?: SystemAudioSource | null;
}

interface UseLiveTranscriptionOptions {
  onMicrophoneFinalTranscript: (segment: CaptureSegment) => Promise<void>;
  onNativeCaptureSegment: (payload: CaptureSegmentEventPayload) => void;
}

interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
}

type ScriptProcessorNodeLike = ScriptProcessorNode;

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
}: UseLiveTranscriptionOptions) {
  const [captureState, setCaptureState] = useState<CaptureRuntimeState>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureHealth, setCaptureHealth] = useState<CaptureHealthPayload | null>(null);
  const [captureSourceLabel, setCaptureSourceLabel] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
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
  const lastFinalTranscriptRef = useRef("");
  const pendingInterimTranscriptRef = useRef("");
  const microphoneSpeakerLabelRef = useRef("Meeting");
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const screenContextCacheRef = useRef<ScreenContextInput | null>(null);

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
      activeNativeSessionIdRef.current = null;
      return;
    }

    if (payload.message) {
      setCaptureError(payload.message);
    }
  });

  const handleMicrophoneFinalTranscript = useEffectEvent(async (text: string, speakerLabel: string) => {
    await onMicrophoneFinalTranscript({
      text,
      speakerLabel,
      source: "capture",
    });
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

  const flushPendingBrowserTranscript = useEffectEvent(async () => {
    const speakerLabel = microphoneSpeakerLabelRef.current;
    const finalTranscript = resolvePendingMicrophoneTranscript(
      pendingInterimTranscriptRef.current,
      lastFinalTranscriptRef.current
    );

    pendingInterimTranscriptRef.current = "";
    setPartialTranscript("");

    if (!finalTranscript) {
      return;
    }

    lastFinalTranscriptRef.current = finalTranscript;
    await handleMicrophoneFinalTranscript(finalTranscript, speakerLabel);
  });

  const stopBrowserMicrophoneCapture = useEffectEvent(async () => {
    if (captureStateRef.current !== "idle") {
      captureStateRef.current = "stopping";
      setCaptureState("stopping");
    }

    await flushPendingBrowserTranscript();

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
    setCaptureSourceLabel(null);
    lastFinalTranscriptRef.current = "";
    pendingInterimTranscriptRef.current = "";
  });

  const startBrowserMicrophoneCapture = useEffectEvent(
    async ({ apiKey, language, speakerLabel = "Meeting" }: StartCaptureOptions) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCaptureError("Audio capture is not available in this runtime.");
        setCaptureState("unsupported");
        captureStateRef.current = "unsupported";
        return;
      }

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        setCaptureError("AudioContext is unavailable, so live transcription cannot start.");
        setCaptureState("unsupported");
        captureStateRef.current = "unsupported";
        return;
      }

      if (!apiKey) {
        throw new Error("Add a Deepgram API key from Onboarding to enable live transcription.");
      }

      try {
        microphoneSpeakerLabelRef.current = speakerLabel;
        lastFinalTranscriptRef.current = "";
        pendingInterimTranscriptRef.current = "";
        setCaptureError(null);
        setCaptureState("connecting");
        captureStateRef.current = "connecting";

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (mediaStream.getAudioTracks().length === 0) {
          throw new Error("The selected microphone stream did not provide any audio tracks.");
        }
        audioStreamRef.current = mediaStream;

        const audioContext = new AudioContextCtor();
        audioContextRef.current = audioContext;
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => undefined);
        }

        const endpoint = new URL("wss://api.deepgram.com/v1/listen");
        endpoint.searchParams.set("encoding", "linear16");
        endpoint.searchParams.set("channels", "1");
        endpoint.searchParams.set("sample_rate", String(Math.round(audioContext.sampleRate)));
        endpoint.searchParams.set("punctuate", "true");
        endpoint.searchParams.set("smart_format", "true");
        endpoint.searchParams.set("interim_results", "true");
        endpoint.searchParams.set("model", "nova-3");
        const mappedLanguage = mapAudioLanguage(language);
        if (mappedLanguage) {
          endpoint.searchParams.set("language", mappedLanguage);
        }

        const websocket = new WebSocket(endpoint, ["token", apiKey]);
        websocket.binaryType = "arraybuffer";
        websocketRef.current = websocket;

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

          if (payload.type !== "Results") {
            return;
          }

          const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (!transcript) {
            if (payload.is_final) {
              pendingInterimTranscriptRef.current = "";
              setPartialTranscript("");
            }
            return;
          }

          if (payload.is_final) {
            pendingInterimTranscriptRef.current = "";
            setPartialTranscript("");
            if (transcript !== lastFinalTranscriptRef.current) {
              lastFinalTranscriptRef.current = transcript;
              void handleMicrophoneFinalTranscript(transcript, speakerLabel);
            }
            return;
          }

          pendingInterimTranscriptRef.current = transcript;
          setPartialTranscript(transcript);
        };

        websocket.onerror = () => {
          setCaptureError("Deepgram live transcription connection failed.");
          setCaptureState("error");
          captureStateRef.current = "error";
        };

        websocket.onclose = () => {
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
          if (captureStateRef.current === "listening" || captureStateRef.current === "connecting") {
            setCaptureError("Live transcription disconnected. You can start it again.");
            setCaptureState("error");
            captureStateRef.current = "error";
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

          keepAliveRef.current = window.setInterval(() => {
            if (websocket.readyState === WebSocket.OPEN) {
              websocket.send(JSON.stringify({ type: "KeepAlive" }));
            }
          }, KEEP_ALIVE_INTERVAL_MS);

          setCaptureState("listening");
          captureStateRef.current = "listening";
          setCaptureError(null);
          setCaptureSourceLabel("Microphone");
        };
      } catch (error) {
        await stopBrowserMicrophoneCapture();
        const message =
          error instanceof Error ? error.message : "Live transcription could not start with the current microphone setup.";
        setCaptureError(message);
        setCaptureState("error");
        captureStateRef.current = "error";
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

  const listAvailableSystemAudioSources = useEffectEvent(async (): Promise<SystemAudioSourceListPayload> => {
    const payload = await listSystemAudioSources();
    if (payload.permissionStatus !== "granted") {
      setCaptureError(
        payload.message ??
          "Screen Recording permission is required before TPMCluely can capture system audio."
      );
    } else {
      setCaptureError(null);
    }
    return payload;
  });

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
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const unlistenFn of unlistenFns) {
        unlistenFn();
      }
    };
  }, [applyNativeCaptureState, onNativeCaptureSegment]);

  useEffect(() => {
    return () => {
      void stopCapture();
      void stopScreenShare();
    };
  }, [stopCapture, stopScreenShare]);

  return {
    captureError,
    captureHealth,
    captureSourceLabel,
    captureState,
    isCapturing: ["starting", "connecting", "listening", "degraded", "stopping"].includes(captureState),
    listAvailableSystemAudioSources,
    partialTranscript,
    screenShareError,
    screenShareOwnedByCapture,
    screenShareState,
    startCapture,
    startScreenShare,
    stopCapture,
    stopScreenShare,
    captureScreenContext,
  };
}
