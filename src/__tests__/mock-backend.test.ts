import { beforeEach, describe, expect, it } from "vitest";

import {
  appendMockTranscriptSegment,
  completeMockSession,
  pushMockGeneratedTicket,
  regenerateMockSessionTickets,
  saveMockSecret,
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

  it("preserves push metadata for unchanged tickets during regeneration", async () => {
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

    const pushed = await pushMockGeneratedTicket({
      sessionId: session.session.id,
      idempotencyKey: firstTicket?.idempotencyKey ?? "",
    });
    const pushedTicket = pushed?.generatedTickets.find((ticket) => ticket.idempotencyKey === firstTicket?.idempotencyKey);
    expect(pushedTicket?.linearPushState).toBe("pushed");
    expect(pushedTicket?.linearIssueKey).toBeTruthy();

    const regenerated = await regenerateMockSessionTickets(session.session.id);
    const regeneratedTicket = regenerated?.generatedTickets.find(
      (ticket) => ticket.idempotencyKey === firstTicket?.idempotencyKey
    );

    expect(regenerated?.session.ticketGenerationState).toBe("succeeded");
    expect(regeneratedTicket?.linearPushState).toBe("pushed");
    expect(regeneratedTicket?.linearIssueKey).toBe(pushedTicket?.linearIssueKey);
    expect(regeneratedTicket?.linearIssueUrl).toBe(pushedTicket?.linearIssueUrl);
  });
});
