import { AssistantFeed } from "../components/AssistantFeed";
import { SpeakerRoster } from "../components/SpeakerRoster";
import type { SessionDetail as SessionDetailModel } from "../lib/types";
import { NotesView } from "./NotesView";
import { TranscriptView } from "./TranscriptView";

interface SessionDetailProps {
  highlightedSequenceStart?: number | null;
  highlightedSequenceEnd?: number | null;
  onExportSession: (sessionDetail: SessionDetailModel) => void;
  onRenameSpeaker: (sessionId: string, speakerId: string, displayLabel: string) => Promise<void>;
  sessionDetail: SessionDetailModel | null;
}

export function SessionDetail({
  highlightedSequenceStart = null,
  highlightedSequenceEnd = null,
  onExportSession,
  onRenameSpeaker,
  sessionDetail,
}: SessionDetailProps) {
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
          {sessionDetail.session.repoContext ? (
            <span className="message-chip">
              Repo: {sessionDetail.session.repoContext.ownerRepo}@{sessionDetail.session.repoContext.branch}
            </span>
          ) : null}
          {sessionDetail.session.repoContext?.snapshotCommit ? (
            <span className="message-chip">
              Snapshot: {sessionDetail.session.repoContext.snapshotCommit.slice(0, 7)}
            </span>
          ) : null}
        </div>
        {sessionDetail.session.repoContext ? (
          <p className="card-detail">
            {sessionDetail.session.repoContext.liveSearchEnabled ? "Hybrid live repo search enabled." : "Snapshot-only repo search."}
            {" "}
            {sessionDetail.session.repoContext.snapshotSyncedAt
              ? `Pinned from ${new Date(sessionDetail.session.repoContext.snapshotSyncedAt).toLocaleString()}.`
              : "No synced snapshot was pinned when this meeting started."}
          </p>
        ) : null}
        <div className="toolbar-row">
          <button type="button" onClick={() => onExportSession(sessionDetail)}>
            Export Markdown
          </button>
        </div>
      </article>
      <NotesView session={sessionDetail.session} />
      <SpeakerRoster
        sessionId={sessionDetail.session.id}
        speakers={sessionDetail.speakers}
        onRenameSpeaker={onRenameSpeaker}
      />
      <AssistantFeed
        messages={sessionDetail.messages}
        title="Assistant Trace"
        emptyTitle="No assistant trace yet"
        emptyDetail="Ask TPMCluely or run a dynamic action during the meeting to capture grounded responses here."
      />
      <TranscriptView
        transcripts={sessionDetail.transcripts}
        highlightedSequenceStart={highlightedSequenceStart}
        highlightedSequenceEnd={highlightedSequenceEnd}
      />
    </div>
  );
}
