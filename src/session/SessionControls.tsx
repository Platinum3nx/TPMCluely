import { useState } from "react";
import type { CaptureMode, SessionDetail } from "../lib/types";

interface SessionControlsProps {
  activeSession: SessionDetail | null;
  captureError: string | null;
  captureMode: CaptureMode;
  captureState: string;
  overlayOpen: boolean;
  overlayShortcut: string;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStopLiveCapture: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
  onSeedTranscript: () => Promise<void>;
}

export function SessionControls({
  activeSession,
  captureError,
  captureMode,
  captureState,
  overlayOpen,
  overlayShortcut,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onSetCaptureMode,
  onStartLiveCapture,
  onStopLiveCapture,
  onToggleOverlay,
  onSeedTranscript,
}: SessionControlsProps) {
  const [title, setTitle] = useState("Sprint planning sync");
  const status = activeSession?.session.status ?? "idle";

  if (!activeSession) {
    return (
      <article className="card">
        <p className="card-title">Start a Session</p>
        <p className="card-detail">
          Sessions drive the live overlay. Start one here and the app will be ready for live transcript capture,
          Ask Cluely answers, and automatic ticket creation when the meeting ends.
        </p>
        <div className="field-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session title" />
          <button type="button" onClick={() => void onStartSession(title)} disabled={title.trim().length === 0}>
            Start Meeting
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-title">Session Controls</p>
      <div className="readiness-row">
        <span>Status</span>
        <strong>{status}</strong>
      </div>
      <div className="readiness-row">
        <span>Started</span>
        <strong>{new Date(activeSession.session.startedAt ?? activeSession.session.updatedAt).toLocaleTimeString()}</strong>
      </div>
      <div className="readiness-row">
        <span>Live transcript</span>
        <strong>{captureState}</strong>
      </div>
      <div className="field">
        <span>Capture mode</span>
        <select value={captureMode} onChange={(event) => onSetCaptureMode(event.target.value as CaptureMode)}>
          <option value="system_audio">System audio + Deepgram</option>
          <option value="microphone">Microphone + Deepgram</option>
          <option value="manual">Manual only</option>
          <option value="demo_stream">Demo transcript</option>
        </select>
      </div>
      <div className="toolbar-row">
        {captureState === "listening" || captureState === "connecting" || captureState === "stopping" ? (
          <button type="button" onClick={() => void onStopLiveCapture()}>
            Stop Live Transcript
          </button>
        ) : (
          <button type="button" onClick={() => void onStartLiveCapture()}>
            Start Live Transcript
          </button>
        )}
        <button type="button" className="secondary-button" onClick={() => void onToggleOverlay()}>
          {overlayOpen ? "Close Overlay" : "Open Overlay"}
        </button>
        {status === "active" ? (
          <button type="button" onClick={() => void onPauseSession(activeSession.session.id)}>
            Pause
          </button>
        ) : null}
        {status === "paused" ? (
          <button type="button" onClick={() => void onResumeSession(activeSession.session.id)}>
            Resume
          </button>
        ) : null}
        {status !== "completed" ? (
          <button type="button" onClick={() => void onCompleteSession(activeSession.session.id)}>
            End Session
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={() => void onSeedTranscript()}>
          Load Demo Transcript
        </button>
      </div>
      <p className="card-detail">Overlay shortcut: {overlayShortcut}</p>
      {captureError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Live transcription needs attention</strong>
          <p>{captureError}</p>
        </div>
      ) : null}
    </article>
  );
}
