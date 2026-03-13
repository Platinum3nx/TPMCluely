import { AssistantFeed } from "../components/AssistantFeed";
import type { SessionDetail as SessionDetailModel } from "../lib/types";
import { NotesView } from "./NotesView";
import { TranscriptView } from "./TranscriptView";

interface SessionDetailProps {
  highlightedSequenceNo?: number | null;
  onExportSession: (sessionDetail: SessionDetailModel) => void;
  sessionDetail: SessionDetailModel | null;
}

export function SessionDetail({ highlightedSequenceNo = null, onExportSession, sessionDetail }: SessionDetailProps) {
  if (!sessionDetail) {
    return (
      <article className="card">
        <div className="empty-block">
          <strong>Select a session</strong>
          <p>Completed meetings show transcript, assistant output, notes, and ticket evidence here.</p>
        </div>
      </article>
    );
  }

  return (
    <div className="card-stack">
      <article className="card">
        <div className="section-header">
          <div>
            <p className="card-title">{sessionDetail.session.title}</p>
            <p className="card-detail">
              Started {sessionDetail.session.startedAt ? new Date(sessionDetail.session.startedAt).toLocaleString() : "n/a"}
            </p>
          </div>
          <span className="section-meta">{sessionDetail.session.status}</span>
        </div>
        <div className="message-chip-row">
          <span className="message-chip">{sessionDetail.transcripts.length} transcript segments</span>
          <span className="message-chip">{sessionDetail.messages.length} assistant messages</span>
          <span className="message-chip">{sessionDetail.generatedTickets.length} ticket drafts</span>
        </div>
        <div className="toolbar-row">
          <button type="button" onClick={() => onExportSession(sessionDetail)}>
            Export Markdown
          </button>
        </div>
      </article>
      <NotesView session={sessionDetail.session} />
      <AssistantFeed
        messages={sessionDetail.messages}
        title="Assistant Trace"
        emptyTitle="No assistant trace yet"
        emptyDetail="Ask TPMCluely or run a dynamic action during the meeting to capture grounded responses here."
      />
      <TranscriptView transcripts={sessionDetail.transcripts} highlightedSequenceNo={highlightedSequenceNo} />
    </div>
  );
}
