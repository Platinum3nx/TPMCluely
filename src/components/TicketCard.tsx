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
      <div className="notes-grid">
        <section>
          <h3>Acceptance Criteria</h3>
          <pre>{ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}</pre>
        </section>
        <section>
          <h3>Transcript Source</h3>
          <pre>{ticket.sourceLine}</pre>
        </section>
      </div>
    </article>
  );
}
