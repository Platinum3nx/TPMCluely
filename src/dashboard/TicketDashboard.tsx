import { useState } from "react";

import { TicketCard } from "../components/TicketCard";
import { generateTicketsFromSession } from "../lib/ticket-engine";
import type { GeneratedTicket, SessionDetail, TicketType } from "../lib/types";

interface TicketDashboardProps {
  allowPreview: boolean;
  onGenerateTickets: (sessionId: string) => Promise<void>;
  onPushGeneratedTicket: (sessionId: string, idempotencyKey: string) => Promise<void>;
  onPushGeneratedTickets: (sessionId: string) => Promise<void>;
  onSetGeneratedTicketReviewState: (
    sessionId: string,
    idempotencyKey: string,
    reviewState: "draft" | "approved" | "rejected",
    rejectionReason?: string | null
  ) => Promise<void>;
  onUpdateGeneratedTicketDraft: (
    sessionId: string,
    idempotencyKey: string,
    draft: { acceptanceCriteria: string[]; description: string; title: string; type: TicketType }
  ) => Promise<void>;
  sessionDetail: SessionDetail | null;
}

function hasReviewHistory(ticket: GeneratedTicket): boolean {
  return ticket.linearPushState === "pushed" || ticket.reviewState !== "draft" || Boolean(ticket.reviewedAt);
}

export function TicketDashboard({
  allowPreview,
  onGenerateTickets,
  onPushGeneratedTicket,
  onPushGeneratedTickets,
  onSetGeneratedTicketReviewState,
  onUpdateGeneratedTicketDraft,
  sessionDetail,
}: TicketDashboardProps) {
  const [bulkPushInFlight, setBulkPushInFlight] = useState(false);
  const [generationInFlight, setGenerationInFlight] = useState(false);
  const session = sessionDetail?.session ?? null;

  const persistedTickets = sessionDetail?.generatedTickets ?? [];
  const fallbackTickets =
    allowPreview && sessionDetail && persistedTickets.length === 0 ? generateTicketsFromSession(sessionDetail) : [];
  const tickets = persistedTickets.length > 0 ? persistedTickets : fallbackTickets;
  const isFallback = persistedTickets.length === 0 && fallbackTickets.length > 0;
  const approvedCount = persistedTickets.filter((ticket) => ["approved", "push_failed"].includes(ticket.reviewState)).length;
  const rejectedCount = persistedTickets.filter((ticket) => ticket.reviewState === "rejected").length;
  const pushedCount = persistedTickets.filter((ticket) => ticket.linearPushState === "pushed").length;
  const hasReviewHistoryAlready = persistedTickets.some(hasReviewHistory);
  const canRegenerate = session?.status === "completed" && !isFallback && !hasReviewHistoryAlready;
  const canGenerate = session?.status === "completed" && !generationInFlight;
  const hasPushableTicket = persistedTickets.some(
    (ticket) => ticket.linearPushState !== "pushed" && ["approved", "push_failed"].includes(ticket.reviewState)
  );

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

  async function handlePushApprovedTickets() {
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
        <div>
          <p className="card-title">Ticket Review Queue</p>
          <span className="section-meta">
            {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
            {isFallback ? " · preview only" : ""}
          </span>
        </div>
        <div className="message-chip-row">
          <span className="message-chip">{approvedCount} approved</span>
          <span className="message-chip">{rejectedCount} rejected</span>
          <span className="message-chip">{pushedCount} pushed</span>
        </div>
      </div>
      {!sessionDetail ? (
        <div className="empty-block">
          <strong>Select a session to review tickets</strong>
          <p>Completed sessions show generated draft tickets here before anything is allowed to reach Linear.</p>
        </div>
      ) : (
        <>
          <div className="ticket-dashboard-toolbar">
            <div className="ticket-dashboard-meta">
              <span>Generation state</span>
              <strong>{session?.ticketGenerationState.replaceAll("_", " ")}</strong>
              <p className="card-detail">TPMCluely generates local drafts first. Linear push is always review-driven.</p>
            </div>
            <div className="toolbar-row">
              {persistedTickets.length === 0 && canGenerate ? (
                <button type="button" disabled={generationInFlight} onClick={() => void handleGenerateTickets()}>
                  {generationInFlight ? "Generating..." : "Generate draft tickets"}
                </button>
              ) : null}
              {persistedTickets.length > 0 && canRegenerate ? (
                <button type="button" disabled={generationInFlight} onClick={() => void handleGenerateTickets()}>
                  {generationInFlight ? "Regenerating..." : "Regenerate drafts"}
                </button>
              ) : null}
              {!isFallback && hasPushableTicket ? (
                <button type="button" disabled={bulkPushInFlight} onClick={() => void handlePushApprovedTickets()}>
                  {bulkPushInFlight ? "Pushing..." : "Push approved to Linear"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="inline-alert inline-alert-soft">
            <strong>Review-first workflow</strong>
            <p>Approve only the drafts you want in Linear. Rejected drafts stay local, and pushed issues are never overwritten.</p>
          </div>

          {session?.ticketGenerationError ? (
            <div className="inline-alert">
              <strong>Ticket generation failed</strong>
              <p>{session.ticketGenerationError}</p>
            </div>
          ) : null}

          {tickets.length === 0 ? (
            <div className="empty-block">
              <strong>No ticket drafts yet</strong>
              <p>
                {allowPreview
                  ? "Finish the rehearsal meeting to preview draft tickets, then approve them before pushing."
                  : "Finish the meeting to generate draft tickets, or add more transcript signal first."}
              </p>
            </div>
          ) : (
            <div className="card-stack">
              {tickets.map((ticket) => (
                <TicketCard
                  key={ticket.idempotencyKey}
                  bulkPushDisabled={bulkPushInFlight}
                  ticket={ticket}
                  onPush={
                    isFallback
                      ? undefined
                      : async (selectedTicket) => {
                          await onPushGeneratedTicket(selectedTicket.sessionId, selectedTicket.idempotencyKey);
                        }
                  }
                  onSaveDraft={
                    isFallback
                      ? undefined
                      : async (selectedTicket, draft) => {
                          await onUpdateGeneratedTicketDraft(selectedTicket.sessionId, selectedTicket.idempotencyKey, draft);
                        }
                  }
                  onSetReviewState={
                    isFallback
                      ? undefined
                      : async (selectedTicket, reviewState, rejectionReason) => {
                          await onSetGeneratedTicketReviewState(
                            selectedTicket.sessionId,
                            selectedTicket.idempotencyKey,
                            reviewState,
                            rejectionReason
                          );
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
