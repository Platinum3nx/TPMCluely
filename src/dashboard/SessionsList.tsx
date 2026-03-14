import type { SessionStatus } from "../lib/types";

interface SessionsListProps {
  sessions: Array<{
    sessionId: string;
    title: string;
    status: SessionStatus;
    updatedAt: string;
    snippet: string | null;
    matchedField: string | null;
    matchLabel: string | null;
    retrievalMode: "lexical" | "hybrid" | null;
    transcriptSequenceStart: number | null;
    transcriptSequenceEnd: number | null;
  }>;
  selectedSessionId: string | null;
  onSelectSession: (
    sessionId: string,
    transcriptSequenceStart?: number | null,
    transcriptSequenceEnd?: number | null
  ) => void;
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
              onClick={() =>
                onSelectSession(
                  session.sessionId,
                  session.transcriptSequenceStart,
                  session.transcriptSequenceEnd
                )
              }
            >
              <strong>{session.title}</strong>
              <span>{session.status}</span>
              <p>{new Date(session.updatedAt).toLocaleString()}</p>
              {session.snippet ? <p>{session.snippet}</p> : null}
              {session.matchLabel ? <span>{session.matchLabel}</span> : null}
              {session.retrievalMode ? <span>Mode: {session.retrievalMode}</span> : null}
            </button>
          ))
        )}
      </div>
    </article>
  );
}
