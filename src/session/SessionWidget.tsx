import { AskBar } from "./AskBar";
import { DynamicActions } from "./DynamicActions";
import { SessionControls } from "./SessionControls";
import { TranscriptPanel } from "./TranscriptPanel";
import type { SessionDetail } from "../lib/types";

interface SessionWidgetProps {
  activeSession: SessionDetail | null;
  onStartSession: (title: string) => Promise<void>;
  onPauseSession: (sessionId: string) => Promise<void>;
  onResumeSession: (sessionId: string) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
  onAppendTranscript: (speakerLabel: string, text: string) => Promise<void>;
  onDynamicAction: (action: "summary" | "decisions" | "next_steps" | "follow_up") => Promise<void>;
  onAsk: (prompt: string) => Promise<void>;
  onSeedTranscript: () => Promise<void>;
}

export function SessionWidget({
  activeSession,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onCompleteSession,
  onAppendTranscript,
  onDynamicAction,
  onAsk,
  onSeedTranscript,
}: SessionWidgetProps) {
  return (
    <section className="panel session-grid">
      <div className="panel-hero">
        <p className="eyebrow">Live Session Widget</p>
        <h2>Compact, persistent, and only visible when a session is active.</h2>
        <p className="muted">
          This surface now supports the first real product loop: start a session, build transcript signal, run quick
          actions, ask context-aware questions, and finish into a dashboard-ready record.
        </p>
      </div>

      <div className="session-grid-body">
        <div className="card-stack">
          <SessionControls
            activeSession={activeSession}
            onStartSession={onStartSession}
            onPauseSession={onPauseSession}
            onResumeSession={onResumeSession}
            onCompleteSession={onCompleteSession}
            onSeedTranscript={onSeedTranscript}
          />
          <DynamicActions disabled={!activeSession} onRunAction={onDynamicAction} />
          <AskBar disabled={!activeSession} onAsk={onAsk} />
        </div>

        <div className="card-stack">
          <TranscriptPanel
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
