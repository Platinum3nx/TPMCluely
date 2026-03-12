import type { GeneratedTicket } from "../lib/types";

interface TicketCardProps {
  ticket: GeneratedTicket;
}

export function TicketCard({ ticket }: TicketCardProps) {
  return (
    <article className="card ticket-card">
      <div className="section-header">
        <p className="card-title">{ticket.title}</p>
        <span className="section-meta">{ticket.type}</span>
      </div>
      <p className="card-detail">{ticket.description}</p>
      <div className="readiness-row">
        <span>Linear status</span>
        <strong>{ticket.linearIssueKey ? ticket.linearIssueKey : ticket.pushedAt ? "Pushed" : "Pending push"}</strong>
      </div>
      <div className="notes-grid">
        <section>
          <h3>Acceptance Criteria</h3>
          <pre>{ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}</pre>
        </section>
        <section>
          <h3>Transcript Source</h3>
          <pre>{ticket.sourceLine ?? "Transcript-wide synthesis"}</pre>
        </section>
      </div>
      {ticket.linearIssueUrl ? (
        <div className="toolbar-row">
          <a href={ticket.linearIssueUrl} target="_blank" rel="noreferrer" className="inline-link">
            Open {ticket.linearIssueKey ?? "Linear issue"}
          </a>
        </div>
      ) : null}
    </article>
  );
}
