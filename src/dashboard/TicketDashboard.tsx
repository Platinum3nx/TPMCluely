import type { SessionDetail } from "../lib/types";
import { generateTicketsFromSession } from "../lib/ticket-engine";
import { TicketCard } from "../components/TicketCard";

interface TicketDashboardProps {
  sessionDetail: SessionDetail | null;
}

export function TicketDashboard({ sessionDetail }: TicketDashboardProps) {
  const tickets = sessionDetail ? generateTicketsFromSession(sessionDetail) : [];

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Ticket Generation</p>
        <span className="section-meta">{tickets.length} tickets</span>
      </div>
      {!sessionDetail ? (
        <div className="empty-block">
          <strong>Select a session to generate tickets</strong>
          <p>The ticket engine uses transcript lines and derived notes to create implementation-ready cards.</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="empty-block">
          <strong>No ticket candidates yet</strong>
          <p>Add more transcript signal or generate session actions first.</p>
        </div>
      ) : (
        <div className="card-stack">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.idempotencyKey} ticket={ticket} />
          ))}
        </div>
      )}
    </article>
  );
}
