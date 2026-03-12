import { describe, expect, it } from "vitest";
import { generateTicketsFromSession } from "../lib/ticket-engine";
import type { SessionDetail } from "../lib/types";

const fixture: SessionDetail = {
  session: {
    id: "session_1",
    title: "Auth rollout",
    status: "completed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rollingSummary: "Auth rollout, timeout stability, and QA follow-up.",
    finalSummary: "This session focused on stabilizing the authentication rollout and staging validation.",
    decisionsMd: "- Ship the auth timeout fix this sprint.",
    actionItemsMd: "- Engineer owns the rate-limit patch.\n- QA validates staging.",
    followUpEmailMd: "Follow-up draft",
    notesMd: "- Auth rollout\n- QA validation",
  },
  transcripts: [
    {
      id: "seg_1",
      sessionId: "session_1",
      sequenceNo: 1,
      speakerLabel: "PM",
      text: "We need to confirm the auth rollout and reduce login timeout incidents.",
      isFinal: true,
      source: "manual",
      createdAt: new Date().toISOString(),
    },
    {
      id: "seg_2",
      sessionId: "session_1",
      sequenceNo: 2,
      speakerLabel: "Engineer",
      text: "I can own the rate-limit fix and the session timeout patch this sprint.",
      isFinal: true,
      source: "manual",
      createdAt: new Date().toISOString(),
    },
  ],
  messages: [],
  generatedTickets: [],
};

describe("generateTicketsFromSession", () => {
  it("creates deterministic ticket candidates from session transcript signal", () => {
    const tickets = generateTicketsFromSession(fixture);

    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets[0].idempotencyKey).toMatch(/^tg_/);
    expect(tickets.some((ticket) => ticket.type === "Bug" || ticket.type === "Feature")).toBe(true);
  });
});
