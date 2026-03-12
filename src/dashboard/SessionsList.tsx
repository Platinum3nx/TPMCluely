import type { SessionRecord } from "../lib/types";

interface SessionsListProps {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
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
            <strong>No completed or active sessions yet</strong>
            <p>Start a session from the widget to create your first dashboard record.</p>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              className={`session-list-item ${selectedSessionId === session.id ? "session-list-item-active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <strong>{session.title}</strong>
              <span>{session.status}</span>
              <p>{new Date(session.updatedAt).toLocaleString()}</p>
            </button>
          ))
        )}
      </div>
    </article>
  );
}
