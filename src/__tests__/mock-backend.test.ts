import { beforeEach, describe, expect, it } from "vitest";

import {
  appendMockTranscriptSegment,
  completeMockSession,
  pushMockGeneratedTicket,
  regenerateMockSessionTickets,
  renameMockSessionSpeaker,
  saveMockSecret,
  setMockGeneratedTicketReviewState,
  startMockSession,
} from "../lib/mock-backend";

describe("mock ticket pipeline", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps prior tickets when regeneration fails and marks the session as failed", async () => {
    const session = await startMockSession({ title: "Planning sync" });
    await appendMockTranscriptSegment({
      sessionId: session.session.id,
      speakerLabel: "Engineer",
      text: "I will implement the rollout guardrail and fix the login timeout regression.",
      source: "manual",
    });

    const completed = await completeMockSession(session.session.id);
    expect(completed?.generatedTickets.length).toBeGreaterThan(0);

    await appendMockTranscriptSegment({
      sessionId: session.session.id,
      speakerLabel: "PM",
      text: "__mock_ticket_generation_fail__",
      source: "manual",
    });

    const failed = await regenerateMockSessionTickets(session.session.id);
    expect(failed?.session.ticketGenerationState).toBe("failed");
    expect(failed?.session.ticketGenerationError).toContain("Mock ticket generation failed");
    expect(failed?.generatedTickets).toEqual(completed?.generatedTickets);
  });

  it("requires approval before push and blocks regeneration once review history exists", async () => {
    await saveMockSecret({ key: "linear_api_key", value: "linear-key" });
    await saveMockSecret({ key: "linear_team_id", value: "team-123" });

    const session = await startMockSession({ title: "Implementation review" });
    await appendMockTranscriptSegment({
      sessionId: session.session.id,
      speakerLabel: "Engineer",
      text: "I will implement the release checklist and fix the rollback bug before launch.",
      source: "manual",
    });

    const completed = await completeMockSession(session.session.id);
    const firstTicket = completed?.generatedTickets[0];
    expect(firstTicket).toBeTruthy();

    const approved = await setMockGeneratedTicketReviewState({
      sessionId: session.session.id,
      idempotencyKey: firstTicket?.idempotencyKey ?? "",
      reviewState: "approved",
    });
    const approvedTicket = approved?.generatedTickets.find((ticket) => ticket.idempotencyKey === firstTicket?.idempotencyKey);
    expect(approvedTicket?.reviewState).toBe("approved");

    const pushed = await pushMockGeneratedTicket({
      sessionId: session.session.id,
      idempotencyKey: firstTicket?.idempotencyKey ?? "",
    });
    const pushedTicket = pushed?.generatedTickets.find((ticket) => ticket.idempotencyKey === firstTicket?.idempotencyKey);
    expect(pushedTicket?.linearPushState).toBe("pushed");
    expect(pushedTicket?.linearIssueKey).toBeTruthy();

    const regenerated = await regenerateMockSessionTickets(session.session.id);
    expect(regenerated?.session.ticketGenerationState).toBe("failed");
    expect(regenerated?.session.ticketGenerationError).toContain("only allowed while all generated tickets remain unpushed drafts");
    expect(
      regenerated?.generatedTickets.find((ticket) => ticket.idempotencyKey === firstTicket?.idempotencyKey)?.linearPushState
    ).toBe("pushed");
  });

  it("reuses existing manual speakers and renames them across the session", async () => {
    const session = await startMockSession({ title: "Ownership review" });
    const first = await appendMockTranscriptSegment({
      sessionId: session.session.id,
      speakerLabel: "PM",
      text: "I will coordinate the rollout checklist.",
      source: "manual",
    });
    const firstSpeakerId = first?.transcripts[0]?.speakerId;
    expect(firstSpeakerId).toBeTruthy();
    expect(first?.speakers).toHaveLength(1);

    const second = await appendMockTranscriptSegment({
      sessionId: session.session.id,
      speakerLabel: "pm",
      text: "I will follow up with QA.",
      source: "manual",
    });
    expect(second?.transcripts[1]?.speakerId).toBe(firstSpeakerId);
    expect(second?.speakers).toHaveLength(1);

    const renamed = await renameMockSessionSpeaker({
      sessionId: session.session.id,
      speakerId: firstSpeakerId ?? "",
      displayLabel: "Alice",
    });

    expect(renamed?.speakers[0]?.displayLabel).toBe("Alice");
    expect(renamed?.transcripts.every((segment) => segment.speakerLabel === "Alice")).toBe(true);
    expect(renamed?.session.actionItemsMd).toContain("Alice:");
  });
});
