import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardApp } from "../dashboard/DashboardApp";
import type { SearchSessionResult, SessionRecord } from "../lib/types";

const sessionFixture: SessionRecord = {
  id: "session-1",
  title: "Launch review",
  status: "completed",
  startedAt: "2026-03-13T09:00:00Z",
  endedAt: "2026-03-13T09:30:00Z",
  captureMode: "manual",
  captureTargetKind: null,
  captureTargetLabel: null,
  updatedAt: "2026-03-13T09:31:00Z",
  rollingSummary: null,
  finalSummary: "Release review and deployment planning.",
  decisionsMd: null,
  actionItemsMd: null,
  followUpEmailMd: null,
  notesMd: null,
  ticketGenerationState: "not_started",
  ticketGenerationError: null,
  ticketGeneratedAt: null,
};

function renderDashboard({
  searchResults = null,
  semanticSearchReady = false,
  onSearchSessions = vi.fn(
    async (_query: string, _mode: "lexical" | "hybrid", _requestId: string) => undefined
  ),
  onSelectSession = vi.fn(
    async (_sessionId: string, _transcriptSequenceStart?: number | null, _transcriptSequenceEnd?: number | null) =>
      undefined
  ),
}: {
  searchResults?: SearchSessionResult[] | null;
  semanticSearchReady?: boolean;
  onSearchSessions?: (query: string, mode: "lexical" | "hybrid", requestId: string) => Promise<void>;
  onSelectSession?: (
    sessionId: string,
    transcriptSequenceStart?: number | null,
    transcriptSequenceEnd?: number | null
  ) => Promise<void>;
} = {}) {
  render(
    <DashboardApp
      sessions={[sessionFixture]}
      selectedSessionId={null}
      sessionDetail={null}
      searchResults={searchResults}
      highlightedSequenceStart={null}
      highlightedSequenceEnd={null}
      semanticSearchReady={semanticSearchReady}
      onSearchSessions={onSearchSessions}
      onSelectSession={onSelectSession}
      onExportSession={vi.fn()}
      onRenameSpeaker={vi.fn(async () => undefined)}
      onGenerateTickets={vi.fn(async () => undefined)}
      onPushGeneratedTicket={vi.fn(async () => undefined)}
      onPushGeneratedTickets={vi.fn(async () => undefined)}
      onSetGeneratedTicketReviewState={vi.fn(async () => undefined)}
      onUpdateGeneratedTicketDraft={vi.fn(async () => undefined)}
      allowTicketPreview={false}
    />
  );

  return { onSearchSessions, onSelectSession };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardApp search flow", () => {
  it("fires lexical search immediately and hybrid search after the semantic debounce", async () => {
    vi.useFakeTimers();
    const onSearchSessions = vi.fn(
      async (_query: string, _mode: "lexical" | "hybrid", _requestId: string) => undefined
    );
    renderDashboard({ semanticSearchReady: true, onSearchSessions });

    expect(onSearchSessions).toHaveBeenCalledTimes(1);
    expect(onSearchSessions.mock.calls[0]?.[0]).toBe("");
    expect(onSearchSessions.mock.calls[0]?.[1]).toBe("lexical");

    onSearchSessions.mockClear();
    fireEvent.change(screen.getByPlaceholderText("Search titles, summaries, or notes"), {
      target: { value: "rollout owner" },
    });

    expect(onSearchSessions).toHaveBeenCalledTimes(1);
    expect(onSearchSessions.mock.calls[0]?.[0]).toBe("rollout owner");
    expect(onSearchSessions.mock.calls[0]?.[1]).toBe("lexical");

    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(onSearchSessions.mock.calls.some(([, mode]) => mode === "hybrid")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const hybridCall = onSearchSessions.mock.calls.find(
      ([query, mode]) => query === "rollout owner" && mode === "hybrid"
    );
    expect(hybridCall).toBeDefined();
    expect(hybridCall?.[2]).toMatch(/:hybrid$/);
  });

  it("shows match metadata and forwards transcript ranges when selecting a search result", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn(
      async (_sessionId: string, _transcriptSequenceStart?: number | null, _transcriptSequenceEnd?: number | null) =>
        undefined
    );
    renderDashboard({
      semanticSearchReady: true,
      onSelectSession,
      searchResults: [
        {
          sessionId: sessionFixture.id,
          title: sessionFixture.title,
          status: sessionFixture.status,
          updatedAt: sessionFixture.updatedAt,
          snippet: "Engineer: We should deploy after QA signs off.",
          matchedField: "transcript",
          matchLabel: "Hybrid transcript match",
          retrievalMode: "hybrid",
          transcriptSequenceStart: 4,
          transcriptSequenceEnd: 6,
        },
      ],
    });

    fireEvent.change(screen.getByPlaceholderText("Search titles, summaries, or notes"), {
      target: { value: "rollout" },
    });

    expect(screen.getByText("Hybrid transcript match")).toBeInTheDocument();
    expect(screen.getByText("Mode: hybrid")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Launch review/i }));
    expect(onSelectSession).toHaveBeenCalledWith("session-1", 4, 6);
  });
});
