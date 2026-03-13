import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TicketDashboard } from "../dashboard/TicketDashboard";
import type { SessionDetail } from "../lib/types";

function buildDetail(overrides?: Partial<SessionDetail>): SessionDetail {
  return {
    session: {
      id: "session-1",
      title: "Engineering sync",
      status: "completed",
      startedAt: "2026-03-12T10:00:00Z",
      endedAt: "2026-03-12T10:30:00Z",
      captureMode: "manual",
      captureTargetKind: null,
      captureTargetLabel: null,
      updatedAt: "2026-03-12T10:30:00Z",
      rollingSummary: "Summary",
      finalSummary: "Final summary",
      decisionsMd: "- decision",
      actionItemsMd: "- action",
      followUpEmailMd: "email",
      notesMd: "notes",
      ticketGenerationState: "failed",
      ticketGenerationError: "Gemini response was invalid.",
      ticketGeneratedAt: null,
      ...overrides?.session,
    },
    transcripts: [],
    messages: [],
    generatedTickets: [
      {
        id: "ticket-1",
        sessionId: "session-1",
        idempotencyKey: "ticket-1",
        title: "Pending ticket",
        description: "Pending ticket description",
        acceptanceCriteria: ["criterion"],
        type: "Task",
        sourceLine: null,
        linearIssueId: null,
        linearIssueKey: null,
        linearIssueUrl: null,
        pushedAt: null,
        linearPushState: "pending",
        linearLastError: null,
        linearLastAttemptAt: null,
        linearDeduped: false,
        createdAt: "2026-03-12T10:31:00Z",
      },
      {
        id: "ticket-2",
        sessionId: "session-1",
        idempotencyKey: "ticket-2",
        title: "Failed ticket",
        description: "Failed ticket description",
        acceptanceCriteria: ["criterion"],
        type: "Bug",
        sourceLine: null,
        linearIssueId: null,
        linearIssueKey: null,
        linearIssueUrl: null,
        pushedAt: null,
        linearPushState: "failed",
        linearLastError: "Linear returned 503",
        linearLastAttemptAt: "2026-03-12T10:32:00Z",
        linearDeduped: false,
        createdAt: "2026-03-12T10:31:30Z",
      },
      {
        id: "ticket-3",
        sessionId: "session-1",
        idempotencyKey: "ticket-3",
        title: "Linked ticket",
        description: "Linked ticket description",
        acceptanceCriteria: ["criterion"],
        type: "Feature",
        sourceLine: null,
        linearIssueId: "linear-1",
        linearIssueKey: "ENG-42",
        linearIssueUrl: "https://linear.app/org/issue/ENG-42",
        pushedAt: "2026-03-12T10:33:00Z",
        linearPushState: "pushed",
        linearLastError: null,
        linearLastAttemptAt: "2026-03-12T10:33:00Z",
        linearDeduped: true,
        createdAt: "2026-03-12T10:32:00Z",
      },
    ],
    ...overrides,
  };
}

describe("TicketDashboard", () => {
  it("shows failure state, bulk push, and per-ticket actions", () => {
    render(
      <TicketDashboard
        sessionDetail={buildDetail()}
        allowPreview={false}
        onGenerateTickets={vi.fn(async () => undefined)}
        onPushGeneratedTicket={vi.fn(async () => undefined)}
        onPushGeneratedTickets={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("Ticket generation failed")).toBeInTheDocument();
    expect(screen.getByText("Gemini response was invalid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push all to Linear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate tickets" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push to Linear" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry push" })).toBeInTheDocument();
    expect(screen.getByText("Linked existing issue")).toBeInTheDocument();
    expect(screen.getByText("Linear returned 503")).toBeInTheDocument();
  });

  it("allows regeneration when the completed session has not pushed any tickets yet", () => {
    render(
      <TicketDashboard
        sessionDetail={buildDetail({
          session: {
            ...buildDetail().session,
            ticketGenerationState: "succeeded",
            ticketGenerationError: null,
            ticketGeneratedAt: "2026-03-12T10:35:00Z",
          },
          generatedTickets: buildDetail().generatedTickets.slice(0, 2),
        })}
        allowPreview={false}
        onGenerateTickets={vi.fn(async () => undefined)}
        onPushGeneratedTicket={vi.fn(async () => undefined)}
        onPushGeneratedTickets={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "Regenerate tickets" })).toBeInTheDocument();
  });
});
