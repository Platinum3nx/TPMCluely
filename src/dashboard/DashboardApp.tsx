import { useMemo, useState } from "react";
import type { SessionDetail as SessionDetailModel, SessionRecord } from "../lib/types";
import { SearchBar } from "../components/SearchBar";
import { SessionDetail } from "./SessionDetail";
import { SessionsList } from "./SessionsList";
import { TicketDashboard } from "./TicketDashboard";

interface DashboardAppProps {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  sessionDetail: SessionDetailModel | null;
  onSelectSession: (sessionId: string) => Promise<void>;
  onExportSession: (sessionDetail: SessionDetailModel) => void;
}

export function DashboardApp({
  sessions,
  selectedSessionId,
  sessionDetail,
  onSelectSession,
  onExportSession,
}: DashboardAppProps) {
  const [query, setQuery] = useState("");
  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sessions;
    }

    return sessions.filter((session) => {
      const haystack = [
        session.title,
        session.finalSummary ?? "",
        session.notesMd ?? "",
        session.decisionsMd ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [query, sessions]);

  return (
    <section className="panel dashboard-grid">
      <div className="panel-hero">
        <p className="eyebrow">Dashboard Review</p>
        <h2>Transcript-centric session history, exports, notes, and ticket workflows.</h2>
        <p className="muted">
          This dashboard now exposes the first real review loop: session list, transcript detail, and derived notes
          generated from the session widget.
        </p>
      </div>

      <SearchBar value={query} onChange={setQuery} />

      <div className="dashboard-grid-body">
        <SessionsList
          sessions={filteredSessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={(sessionId) => void onSelectSession(sessionId)}
        />
        <div className="card-stack">
          <SessionDetail sessionDetail={sessionDetail} onExportSession={onExportSession} />
          <TicketDashboard sessionDetail={sessionDetail} />
        </div>
      </div>
    </section>
  );
}
