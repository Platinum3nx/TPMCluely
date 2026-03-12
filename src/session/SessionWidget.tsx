import { AskBar } from "./AskBar";
import { DynamicActions } from "./DynamicActions";
import { SessionControls } from "./SessionControls";
import { TranscriptPanel } from "./TranscriptPanel";
import type { CaptureMode, SessionDetail } from "../lib/types";

interface SessionWidgetProps {
  activeSession: SessionDetail | null;
  captureError: string | null;
  captureMode: CaptureMode;
  captureState: string;
  isCapturing: boolean;
  overlayOpen: boolean;
  overlayShortcut: string;
  partialTranscript: string;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
  onDynamicAction: (action: "summary" | "decisions" | "next_steps" | "follow_up") => Promise<void>;
  onAsk: (prompt: string) => Promise<void>;
  onSetCaptureMode: (mode: CaptureMode) => void;
  onStartLiveCapture: () => Promise<void>;
  onStopLiveCapture: () => Promise<void>;
  onToggleOverlay: () => Promise<void>;
  onSeedTranscript: () => Promise<void>;
}

export function SessionWidget({
  activeSession,
  captureError,
  captureMode,
  captureState,
  isCapturing,
  overlayOpen,
  overlayShortcut,
  partialTranscript,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onAppendTranscript,
  onDynamicAction,
  onAsk,
  onSetCaptureMode,
  onStartLiveCapture,
  onStopLiveCapture,
  onToggleOverlay,
  onSeedTranscript,
}: SessionWidgetProps) {
  return (
    <section className={`panel session-grid ${overlayOpen ? "session-grid-overlay" : ""}`}>
      {overlayOpen ? (
        <div className="overlay-banner">
          <div>
            <p className="eyebrow">TPMCluely Overlay</p>
            <h2>{activeSession?.session.title ?? "Live meeting"}</h2>
          </div>
          <div className="overlay-meta">
            <span>{captureState}</span>
            <span>{isCapturing ? "Listening" : "Idle"}</span>
            <span>{overlayShortcut}</span>
          </div>
        </div>
      ) : (
        <div className="panel-hero">
          <p className="eyebrow">Live Session Widget</p>
          <h2>Live transcript, overlay controls, grounded answers, and auto-generated tickets.</h2>
          <p className="muted">
            Start a meeting, stream transcript signal into the assistant, answer live questions with Ask TPMCluely, then
            end the session to generate deduped Linear tickets automatically.
          </p>
        </div>
      )}

      <div className="session-grid-body">
        <div className="card-stack">
          <SessionControls
            activeSession={activeSession}
            captureError={captureError}
            captureMode={captureMode}
            captureState={captureState}
            overlayOpen={overlayOpen}
            overlayShortcut={overlayShortcut}
            onStartSession={onStartSession}
            onPauseSession={onPauseSession}
            onResumeSession={onResumeSession}
            onCompleteSession={onCompleteSession}
            onSetCaptureMode={onSetCaptureMode}
            onStartLiveCapture={onStartLiveCapture}
            onStopLiveCapture={onStopLiveCapture}
            onToggleOverlay={onToggleOverlay}
            onSeedTranscript={onSeedTranscript}
          />
          <DynamicActions disabled={!activeSession} onRunAction={onDynamicAction} />
          <AskBar disabled={!activeSession} onAsk={onAsk} />
        </div>

        <div className="card-stack">
          <TranscriptPanel
            captureMode={captureMode}
            captureState={captureState}
            overlayOpen={overlayOpen}
            partialTranscript={partialTranscript}
            sessionId={activeSession?.session.id ?? null}
            transcripts={activeSession?.transcripts ?? []}
            onAppendTranscript={onAppendTranscript}
          />

          <article className="card message-panel">
            <div className="section-header">
              <p className="card-title">Assistant Feed</p>
              <span className="section-meta">{activeSession?.messages.length ?? 0} messages</span>
            </div>
            <div className="message-feed">
              {(activeSession?.messages ?? []).length === 0 ? (
                <div className="empty-block">
                  <strong>No assistant output yet</strong>
                  <p>Run an action or ask a question to create the first response.</p>
                </div>
              ) : (
                activeSession?.messages.map((message) => (
                  <div key={message.id} className={`message-card message-${message.role}`}>
                    <span>{message.role}</span>
                    <p>{message.content}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
