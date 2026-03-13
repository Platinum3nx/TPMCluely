import type { GeneratedTicket } from "../lib/types";

interface TicketCardProps {
  ticket: GeneratedTicket;
  pushDisabled?: boolean;
  pushInFlight?: boolean;
  onPush?: (ticket: GeneratedTicket) => Promise<void>;
}

function linearStatusLabel(ticket: GeneratedTicket): string {
  if (ticket.linearPushState === "pushed") {
    return ticket.linearDeduped ? "Linked existing issue" : "Pushed";
  }

  if (ticket.linearPushState === "failed") {
    return "Push failed";
  }

  return "Pending push";
}

export function TicketCard({ ticket, pushDisabled = false, pushInFlight = false, onPush }: TicketCardProps) {
  const canPush = Boolean(onPush) && ticket.linearPushState !== "pushed";
  const pushLabel = ticket.linearPushState === "failed" ? "Retry push" : "Push to Linear";

  return (
    <article className="card ticket-card">
      <div className="section-header">
        <p className="card-title">{ticket.title}</p>
        <span className="section-meta">{ticket.type}</span>
      </div>
      <p className="card-detail">{ticket.description}</p>
      <div className="readiness-row">
        <span>Linear status</span>
        <strong>{linearStatusLabel(ticket)}</strong>
      </div>
      {ticket.linearLastError && ticket.linearPushState === "failed" ? (
        <p className="ticket-status-error">{ticket.linearLastError}</p>
      ) : null}
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
      <div className="toolbar-row">
        {canPush ? (
          <button
            type="button"
            disabled={pushDisabled || pushInFlight}
            onClick={() => {
              void onPush?.(ticket);
            }}
          >
            {pushInFlight ? "Pushing..." : pushLabel}
          </button>
        ) : null}
        {ticket.linearIssueUrl ? (
          <a href={ticket.linearIssueUrl} target="_blank" rel="noreferrer" className="inline-link">
            Open {ticket.linearIssueKey ?? "Linear issue"}
          </a>
        ) : null}
      </div>
    </article>
  );
}
