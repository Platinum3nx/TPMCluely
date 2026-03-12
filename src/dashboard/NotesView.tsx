import type { SessionRecord } from "../lib/types";

interface NotesViewProps {
  session: SessionRecord;
}

function block(value: string | null, emptyCopy: string) {
  return value ?? emptyCopy;
}

export function NotesView({ session }: NotesViewProps) {
  return (
    <article className="card notes-card">
      <div className="section-header">
        <p className="card-title">Session Notes</p>
        <span className="section-meta">{session.status}</span>
      </div>
      <div className="notes-grid">
        <section>
          <h3>Summary</h3>
          <p>{block(session.finalSummary, "Finish the session or run a dynamic action to generate a summary.")}</p>
        </section>
        <section>
          <h3>Decisions</h3>
          <pre>{block(session.decisionsMd, "- No decisions yet.")}</pre>
        </section>
        <section>
          <h3>Action Items</h3>
          <pre>{block(session.actionItemsMd, "- No action items yet.")}</pre>
        </section>
        <section>
          <h3>Follow-up Draft</h3>
          <pre>{block(session.followUpEmailMd, "No follow-up draft yet.")}</pre>
        </section>
      </div>
    </article>
  );
}
