import type { SessionDetail as SessionDetailModel, SessionRecord } from "../lib/types";
import { SessionDetail } from "./SessionDetail";
import { SessionsList } from "./SessionsList";

interface DashboardAppProps {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  sessionDetail: SessionDetailModel | null;
  onSelectSession: (sessionId: string) => Promise<void>;
}

export function DashboardApp({ sessions, selectedSessionId, sessionDetail, onSelectSession }: DashboardAppProps) {
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

      <div className="dashboard-grid-body">
        <SessionsList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={(sessionId) => void onSelectSession(sessionId)}
        />
        <SessionDetail sessionDetail={sessionDetail} />
      </div>
    </section>
  );
}
