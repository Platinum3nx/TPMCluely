import type { SessionStatus } from "../lib/types";

interface SessionsListProps {
  sessions: Array<{
    sessionId: string;
    title: string;
    status: SessionStatus;
    updatedAt: string;
    snippet: string | null;
    matchedField: string | null;
    transcriptSequenceNo: number | null;
  }>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, transcriptSequenceNo?: number | null) => void;
}

export function SessionsList({ sessions, selectedSessionId, onSelectSession }: SessionsListProps) {
  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Sessions</p>
        <span className="section-meta">{sessions.length} total</span>
      </div>
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-block">
            <strong>No matching sessions yet</strong>
            <p>Start a session from the widget or adjust the dashboard search query.</p>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              type="button"
              key={session.sessionId}
              className={`session-list-item ${selectedSessionId === session.sessionId ? "session-list-item-active" : ""}`}
              onClick={() => onSelectSession(session.sessionId, session.transcriptSequenceNo)}
            >
              <strong>{session.title}</strong>
              <span>{session.status}</span>
              <p>{new Date(session.updatedAt).toLocaleString()}</p>
              {session.snippet ? <p>{session.snippet}</p> : null}
              {session.matchedField ? <span>Matched: {session.matchedField.replaceAll("_", " ")}</span> : null}
            </button>
          ))
        )}
      </div>
    </article>
  );
}
