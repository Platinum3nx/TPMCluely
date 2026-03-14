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
    captureMode: "manual",
    captureTargetKind: null,
    captureTargetLabel: null,
    updatedAt: new Date().toISOString(),
    rollingSummary: "Auth rollout, timeout stability, and QA follow-up.",
    finalSummary: "This session focused on stabilizing the authentication rollout and staging validation.",
    decisionsMd: "- Ship the auth timeout fix this sprint.",
    actionItemsMd: "- Engineer owns the rate-limit patch.\n- QA validates staging.",
    followUpEmailMd: "Follow-up draft",
    notesMd: "- Auth rollout\n- QA validation",
    repoContext: null,
    ticketGenerationState: "not_started",
    ticketGenerationError: null,
    ticketGeneratedAt: null,
  },
  transcripts: [
    {
      id: "seg_1",
      sessionId: "session_1",
      sequenceNo: 1,
      speakerId: "manual:pm",
      speakerLabel: "PM",
      speakerConfidence: null,
      startMs: 0,
      endMs: 1_500,
      text: "We need to confirm the auth rollout and reduce login timeout incidents.",
      isFinal: true,
      source: "manual",
      createdAt: new Date().toISOString(),
    },
    {
      id: "seg_2",
      sessionId: "session_1",
      sequenceNo: 2,
      speakerId: "manual:engineer",
      speakerLabel: "Engineer",
      speakerConfidence: null,
      startMs: 1_500,
      endMs: 3_000,
      text: "I can own the rate-limit fix and the session timeout patch this sprint.",
      isFinal: true,
      source: "manual",
      createdAt: new Date().toISOString(),
    },
  ],
  speakers: [
    {
      sessionId: "session_1",
      speakerId: "manual:pm",
      providerLabel: null,
      displayLabel: "PM",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      sessionId: "session_1",
      speakerId: "manual:engineer",
      providerLabel: null,
      displayLabel: "Engineer",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
