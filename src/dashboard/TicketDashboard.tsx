import type { SessionDetail } from "../lib/types";
import { generateTicketsFromSession } from "../lib/ticket-engine";
import { TicketCard } from "../components/TicketCard";

interface TicketDashboardProps {
  sessionDetail: SessionDetail | null;
  allowPreview: boolean;
}

export function TicketDashboard({ sessionDetail, allowPreview }: TicketDashboardProps) {
  const persistedTickets = sessionDetail?.generatedTickets ?? [];
  const fallbackTickets =
    allowPreview && sessionDetail && persistedTickets.length === 0 ? generateTicketsFromSession(sessionDetail) : [];
  const tickets = persistedTickets.length > 0 ? persistedTickets : fallbackTickets;
  const isFallback = persistedTickets.length === 0 && fallbackTickets.length > 0;

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Ticket Generation</p>
        <span className="section-meta">
          {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
          {isFallback ? " · heuristic preview" : ""}
        </span>
      </div>
      {!sessionDetail ? (
        <div className="empty-block">
          <strong>Select a session to generate tickets</strong>
          <p>The ticket engine uses transcript lines and derived notes to create implementation-ready cards.</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="empty-block">
          <strong>No ticket candidates yet</strong>
          <p>
            {allowPreview
              ? "End the meeting to run the transcript-to-Linear pipeline, or use the browser preview flow for local mock testing."
              : "End the meeting to run the transcript-to-Linear pipeline, or add more transcript signal first."}
          </p>
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
