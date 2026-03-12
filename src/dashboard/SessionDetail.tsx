import type { SessionDetail as SessionDetailModel } from "../lib/types";
import { NotesView } from "./NotesView";
import { TranscriptView } from "./TranscriptView";

interface SessionDetailProps {
  sessionDetail: SessionDetailModel | null;
}

export function SessionDetail({ sessionDetail }: SessionDetailProps) {
  if (!sessionDetail) {
    return (
      <article className="card">
        <div className="empty-block">
          <strong>Select a session</strong>
          <p>Completed sessions will show transcript, notes, and derived artifacts here.</p>
        </div>
      </article>
    );
  }

  return (
    <div className="card-stack">
      <article className="card">
        <div className="section-header">
          <p className="card-title">{sessionDetail.session.title}</p>
          <span className="section-meta">{sessionDetail.session.status}</span>
        </div>
        <p className="card-detail">
          Started {sessionDetail.session.startedAt ? new Date(sessionDetail.session.startedAt).toLocaleString() : "n/a"}
        </p>
      </article>
      <NotesView session={sessionDetail.session} />
      <TranscriptView transcripts={sessionDetail.transcripts} />
    </div>
  );
}
