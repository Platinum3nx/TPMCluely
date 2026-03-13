import { useState } from "react";
import type { CaptureMode, ScreenShareState, SessionDetail } from "../lib/types";

interface SessionControlsProps {
  activeSession: SessionDetail | null;
  captureError: string | null;
  captureMode: CaptureMode;
  captureSourceLabel: string | null;
  captureState: string;
  overlayOpen: boolean;
  overlayShortcut: string;
  screenContextEnabled: boolean;
  screenShareError: string | null;
  screenShareOwnedByCapture: boolean;
  screenShareState: ScreenShareState;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStartScreenShare: () => Promise<boolean>;
  onStopLiveCapture: () => Promise<void>;
  onStopScreenShare: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
}

export function SessionControls({
  activeSession,
  captureError,
  captureMode,
  captureSourceLabel,
  captureState,
  overlayOpen,
  overlayShortcut,
  screenContextEnabled,
  screenShareError,
  screenShareOwnedByCapture,
  screenShareState,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onSetCaptureMode,
  onStartLiveCapture,
  onStartScreenShare,
  onStopLiveCapture,
  onStopScreenShare,
  onToggleOverlay,
}: SessionControlsProps) {
  const [title, setTitle] = useState("Sprint planning sync");
  const status = activeSession?.session.status ?? "idle";

  if (!activeSession) {
    return (
      <article className="card">
        <p className="card-title">Start a Session</p>
        <p className="card-detail">
          Sessions drive the live overlay. Start one here and the app will be ready for live transcript capture,
          Ask TPMCluely answers, and automatic ticket creation when the meeting ends.
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
      {captureSourceLabel ? (
        <div className="readiness-row">
          <span>Audio source</span>
          <strong>{captureSourceLabel}</strong>
        </div>
      ) : null}
      <div className="readiness-row">
        <span>Screen context</span>
        <strong>{screenShareState}</strong>
      </div>
      <div className="field">
        <span>Capture mode</span>
        <select value={captureMode} onChange={(event) => onSetCaptureMode(event.target.value as CaptureMode)}>
          <option value="system_audio">System audio + Deepgram</option>
          <option value="microphone">Microphone + Deepgram</option>
          <option value="manual">Manual only</option>
        </select>
      </div>
      <div className="toolbar-row">
        {captureState === "listening" || captureState === "connecting" || captureState === "stopping" ? (
          <button type="button" onClick={() => void onStopLiveCapture()}>
            Stop Listening
          </button>
        ) : (
          <button type="button" onClick={() => void onStartLiveCapture()}>
            Start Listening
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
      </div>
      {screenContextEnabled && !screenShareOwnedByCapture ? (
        <div className="toolbar-row">
          {screenShareState === "active" ? (
            <button type="button" className="secondary-button" onClick={() => void onStopScreenShare()}>
              Stop Sharing Screen
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={() => void onStartScreenShare()}>
              Share Screen
            </button>
          )}
        </div>
      ) : null}
      <p className="card-detail">Overlay shortcut: {overlayShortcut}</p>
      {captureError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Live transcription needs attention</strong>
          <p>{captureError}</p>
        </div>
      ) : null}
      {screenShareError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Screen context needs attention</strong>
          <p>{screenShareError}</p>
        </div>
      ) : null}
    </article>
  );
}
