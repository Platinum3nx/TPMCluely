import { useState } from "react";

import { TicketCard } from "../components/TicketCard";
import { generateTicketsFromSession } from "../lib/ticket-engine";
import type { SessionDetail } from "../lib/types";

interface TicketDashboardProps {
  sessionDetail: SessionDetail | null;
  allowPreview: boolean;
  onGenerateTickets: (sessionId: string) => Promise<void>;
  onPushGeneratedTicket: (sessionId: string, idempotencyKey: string) => Promise<void>;
  onPushGeneratedTickets: (sessionId: string) => Promise<void>;
}

export function TicketDashboard({
  sessionDetail,
  allowPreview,
  onGenerateTickets,
  onPushGeneratedTicket,
  onPushGeneratedTickets,
}: TicketDashboardProps) {
  const [generationInFlight, setGenerationInFlight] = useState(false);
  const [bulkPushInFlight, setBulkPushInFlight] = useState(false);
  const [pushingTicketKey, setPushingTicketKey] = useState<string | null>(null);
  const session = sessionDetail?.session ?? null;

  const persistedTickets = sessionDetail?.generatedTickets ?? [];
  const fallbackTickets =
    allowPreview && sessionDetail && persistedTickets.length === 0 ? generateTicketsFromSession(sessionDetail) : [];
  const tickets = persistedTickets.length > 0 ? persistedTickets : fallbackTickets;
  const isFallback = persistedTickets.length === 0 && fallbackTickets.length > 0;
  const hasPushedTicket = persistedTickets.some((ticket) => ticket.linearPushState === "pushed");
  const hasPushableTicket = persistedTickets.some((ticket) => ticket.linearPushState !== "pushed");
  const canRegenerate =
    session?.status === "completed" && !hasPushedTicket && !isFallback;

  async function handleGenerateTickets() {
    if (!sessionDetail) {
      return;
    }

    try {
      setGenerationInFlight(true);
      await onGenerateTickets(sessionDetail.session.id);
    } finally {
      setGenerationInFlight(false);
    }
  }

  async function handlePushAllTickets() {
    if (!sessionDetail) {
      return;
    }

    try {
      setBulkPushInFlight(true);
      await onPushGeneratedTickets(sessionDetail.session.id);
    } finally {
      setBulkPushInFlight(false);
    }
  }

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
      ) : (
        <>
          <div className="ticket-dashboard-toolbar">
            <div className="ticket-dashboard-meta">
              <span>Generation state</span>
              <strong>{session?.ticketGenerationState.replaceAll("_", " ")}</strong>
            </div>
            <div className="toolbar-row">
              {canRegenerate ? (
                <button type="button" disabled={generationInFlight} onClick={() => void handleGenerateTickets()}>
                  {generationInFlight ? "Regenerating..." : "Regenerate tickets"}
                </button>
              ) : null}
              {!isFallback && hasPushableTicket ? (
                <button
                  type="button"
                  disabled={bulkPushInFlight}
                  onClick={() => {
                    void handlePushAllTickets();
                  }}
                >
                  {bulkPushInFlight ? "Pushing..." : "Push all to Linear"}
                </button>
              ) : null}
            </div>
          </div>

          {session?.ticketGenerationError ? (
            <div className="inline-alert">
              <strong>Ticket generation failed</strong>
              <p>{session.ticketGenerationError}</p>
            </div>
          ) : null}

          {tickets.length === 0 ? (
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
                <TicketCard
                  key={ticket.idempotencyKey}
                  ticket={ticket}
                  pushDisabled={bulkPushInFlight}
                  pushInFlight={pushingTicketKey === ticket.idempotencyKey}
                  onPush={
                    isFallback
                      ? undefined
                      : async (selectedTicket) => {
                          try {
                            setPushingTicketKey(selectedTicket.idempotencyKey);
                            await onPushGeneratedTicket(selectedTicket.sessionId, selectedTicket.idempotencyKey);
                          } finally {
                            setPushingTicketKey(null);
                          }
                        }
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}
