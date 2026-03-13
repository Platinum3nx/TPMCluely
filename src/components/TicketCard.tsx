import { useEffect, useState } from "react";
import type { GeneratedTicket, TicketType } from "../lib/types";

interface TicketCardProps {
  bulkPushDisabled?: boolean;
  onPush?: (ticket: GeneratedTicket) => Promise<void>;
  onSaveDraft?: (
    ticket: GeneratedTicket,
    draft: { acceptanceCriteria: string[]; description: string; title: string; type: TicketType }
  ) => Promise<void>;
  onSetReviewState?: (
    ticket: GeneratedTicket,
    reviewState: "draft" | "approved" | "rejected",
    rejectionReason?: string | null
  ) => Promise<void>;
  ticket: GeneratedTicket;
}

function linearStatusLabel(ticket: GeneratedTicket): string {
  if (ticket.linearPushState === "pushed") {
    return ticket.linearDeduped ? "Linked existing issue" : "Pushed";
  }
  if (ticket.linearPushState === "failed") {
    return "Push failed";
  }
  return "Not pushed";
}

function reviewStatusLabel(ticket: GeneratedTicket): string {
  if (ticket.reviewState === "approved") {
    return "Approved for Linear";
  }
  if (ticket.reviewState === "rejected") {
    return "Rejected";
  }
  if (ticket.reviewState === "pushed") {
    return "Pushed";
  }
  if (ticket.reviewState === "push_failed") {
    return "Push failed, still approved";
  }
  return "Draft";
}

export function TicketCard({
  bulkPushDisabled = false,
  onPush,
  onSaveDraft,
  onSetReviewState,
  ticket,
}: TicketCardProps) {
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] = useState(ticket.acceptanceCriteria.join("\n"));
  const [description, setDescription] = useState(ticket.description);
  const [editing, setEditing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState(ticket.rejectionReason ?? "");
  const [title, setTitle] = useState(ticket.title);
  const [type, setType] = useState<TicketType>(ticket.type);
  const [workingAction, setWorkingAction] = useState<string | null>(null);

  useEffect(() => {
    setAcceptanceCriteriaText(ticket.acceptanceCriteria.join("\n"));
    setDescription(ticket.description);
    setRejectionReason(ticket.rejectionReason ?? "");
    setTitle(ticket.title);
    setType(ticket.type);
  }, [ticket]);

  const canEdit = ticket.linearPushState !== "pushed";
  const canPush =
    Boolean(onPush) && ticket.linearPushState !== "pushed" && ["approved", "push_failed"].includes(ticket.reviewState);
  const pushLabel = ticket.linearPushState === "failed" ? "Retry push" : "Push to Linear";

  async function handleSaveDraft() {
    if (!onSaveDraft) {
      return;
    }

    try {
      setWorkingAction("save");
      await onSaveDraft(ticket, {
        title,
        description,
        acceptanceCriteria: acceptanceCriteriaText
          .split("\n")
          .map((criterion) => criterion.trim())
          .filter(Boolean),
        type,
      });
      setEditing(false);
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleReviewState(reviewState: "draft" | "approved" | "rejected") {
    if (!onSetReviewState) {
      return;
    }

    try {
      setWorkingAction(reviewState);
      await onSetReviewState(ticket, reviewState, reviewState === "rejected" ? rejectionReason.trim() || null : null);
      if (reviewState !== "rejected") {
        setRejectionReason("");
      }
    } finally {
      setWorkingAction(null);
    }
  }

  async function handlePush() {
    if (!onPush) {
      return;
    }

    try {
      setWorkingAction("push");
      await onPush(ticket);
    } finally {
      setWorkingAction(null);
    }
  }

  return (
    <article className="card ticket-card">
      <div className="section-header">
        <div>
          <p className="card-title">{ticket.title}</p>
          <div className="message-chip-row">
            <span className="message-chip">{ticket.type}</span>
            <span className="message-chip">{reviewStatusLabel(ticket)}</span>
            <span className="message-chip">{linearStatusLabel(ticket)}</span>
          </div>
        </div>
        {canEdit ? (
          <button type="button" className="secondary-button" onClick={() => setEditing((current) => !current)}>
            {editing ? "Cancel" : "Edit draft"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="ticket-editor">
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} />
          </label>
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(event) => setType(event.target.value as TicketType)}>
              <option value="Task">Task</option>
              <option value="Feature">Feature</option>
              <option value="Bug">Bug</option>
            </select>
          </label>
          <label className="field">
            <span>Acceptance Criteria</span>
            <textarea
              value={acceptanceCriteriaText}
              onChange={(event) => setAcceptanceCriteriaText(event.target.value)}
              rows={4}
            />
          </label>
        </div>
      ) : (
        <>
          <p className="card-detail">{ticket.description}</p>
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
        </>
      )}

      <div className="readiness-row">
        <span>Review state</span>
        <strong>{reviewStatusLabel(ticket)}</strong>
      </div>
      <div className="readiness-row">
        <span>Linear state</span>
        <strong>{linearStatusLabel(ticket)}</strong>
      </div>

      {ticket.rejectedAt ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Rejected draft</strong>
          <p>{ticket.rejectionReason ?? "No rejection reason was recorded."}</p>
        </div>
      ) : null}

      {ticket.linearLastError && ticket.linearPushState === "failed" ? (
        <p className="ticket-status-error">{ticket.linearLastError}</p>
      ) : null}

      {canEdit ? (
        <label className="field">
          <span>Rejection reason</span>
          <input
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Optional note about why this draft should not be pushed."
          />
        </label>
      ) : null}

      <div className="toolbar-row">
        {editing && onSaveDraft ? (
          <button type="button" disabled={workingAction !== null} onClick={() => void handleSaveDraft()}>
            {workingAction === "save" ? "Saving..." : "Save draft"}
          </button>
        ) : null}
        {canEdit && onSetReviewState && ticket.reviewState !== "approved" ? (
          <button type="button" className="secondary-button" disabled={workingAction !== null} onClick={() => void handleReviewState("approved")}>
            {workingAction === "approved" ? "Approving..." : "Approve"}
          </button>
        ) : null}
        {canEdit && onSetReviewState && ticket.reviewState !== "rejected" ? (
          <button type="button" className="secondary-button" disabled={workingAction !== null} onClick={() => void handleReviewState("rejected")}>
            {workingAction === "rejected" ? "Rejecting..." : "Reject"}
          </button>
        ) : null}
        {canEdit && onSetReviewState && ticket.reviewState !== "draft" ? (
          <button type="button" className="secondary-button" disabled={workingAction !== null} onClick={() => void handleReviewState("draft")}>
            {workingAction === "draft" ? "Resetting..." : "Back to draft"}
          </button>
        ) : null}
        {canPush ? (
          <button type="button" disabled={bulkPushDisabled || workingAction !== null} onClick={() => void handlePush()}>
            {workingAction === "push" ? "Pushing..." : pushLabel}
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
