import { useState } from "react";
import type { SessionDetail } from "../lib/types";

interface SessionControlsProps {
  activeSession: SessionDetail | null;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onSeedTranscript: () => Promise<void>;
}

export function SessionControls({
  activeSession,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onSeedTranscript,
}: SessionControlsProps) {
  const [title, setTitle] = useState("Sprint planning sync");
  const status = activeSession?.session.status ?? "idle";

  if (!activeSession) {
    return (
      <article className="card">
        <p className="card-title">Start a Session</p>
        <p className="card-detail">
          Sessions drive the live widget. Start one here, then build transcript signal, run actions, and review it in
          the dashboard.
        </p>
        <div className="field-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session title" />
          <button type="button" onClick={() => void onStartSession(title)} disabled={title.trim().length === 0}>
            Start
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
      <div className="toolbar-row">
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
    </article>
  );
}
