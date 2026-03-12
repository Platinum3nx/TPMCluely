import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CaptureMode } from "../lib/types";

const KEEP_ALIVE_INTERVAL_MS = 8_000;

type CaptureState = "idle" | "connecting" | "listening" | "stopping" | "error" | "unsupported";

interface CaptureSegment {
  speakerLabel?: string;
  text: string;
  source: "capture";
}

interface StartCaptureOptions {
  apiKey: string;
  language: string;
  mode: CaptureMode;
  speakerLabel?: string;
}

interface UseLiveTranscriptionOptions {
  onFinalTranscript: (segment: CaptureSegment) => Promise<void>;
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

export function useLiveTranscription({ onFinalTranscript }: UseLiveTranscriptionOptions) {
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNodeLike | null>(null);
  const silenceNodeRef = useRef<GainNode | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const captureStateRef = useRef<CaptureState>("idle");
  const lastFinalTranscriptRef = useRef("");

  const handleFinalTranscript = useEffectEvent(async (text: string, speakerLabel: string) => {
    await onFinalTranscript({
      text,
      speakerLabel,
      source: "capture",
    });
  });

  function teardownAudioGraph() {
    processorNodeRef.current?.disconnect();
    silenceNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();

    processorNodeRef.current = null;
    silenceNodeRef.current = null;
    sourceNodeRef.current = null;
  }

  const stopCapture = useEffectEvent(async () => {
    captureStateRef.current = "stopping";
    setCaptureState("stopping");
    setPartialTranscript("");
    lastFinalTranscriptRef.current = "";

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

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    captureStateRef.current = "idle";
    setCaptureState("idle");
  });

  const startCapture = useEffectEvent(async ({ apiKey, language, mode, speakerLabel = "Meeting" }: StartCaptureOptions) => {
    await stopCapture();

    if (mode !== "microphone") {
      setCaptureError("Live transcription currently supports microphone capture in the desktop app.");
      setCaptureState("error");
      captureStateRef.current = "error";
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCaptureError("Microphone capture is not available in this runtime.");
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

    try {
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
      mediaStreamRef.current = mediaStream;

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
            setPartialTranscript("");
          }
          return;
        }

        if (payload.is_final) {
          setPartialTranscript("");
          if (transcript !== lastFinalTranscriptRef.current) {
            lastFinalTranscriptRef.current = transcript;
            void handleFinalTranscript(transcript, speakerLabel);
          }
          return;
        }

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
        if (mediaStreamRef.current) {
          for (const track of mediaStreamRef.current.getTracks()) {
            track.stop();
          }
          mediaStreamRef.current = null;
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
      };
    } catch (error) {
      await stopCapture();
      const message =
        error instanceof Error ? error.message : "Live transcription could not start with the current microphone setup.";
      setCaptureError(message);
      setCaptureState("error");
      captureStateRef.current = "error";
    }
  });

  useEffect(() => {
    return () => {
      void stopCapture();
    };
  }, [stopCapture]);

  return {
    captureError,
    captureState,
    isCapturing: captureState === "connecting" || captureState === "listening",
    partialTranscript,
    startCapture,
    stopCapture,
  };
}
