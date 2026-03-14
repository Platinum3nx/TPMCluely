import { beforeEach, describe, expect, it, vi } from "vitest";

type ListenerMap = Map<string, Array<(event: { payload: unknown }) => void>>;

const listeners: ListenerMap = new Map();

const invokeMock = vi.fn(async (command: string, payload?: { input?: { requestId: string } }) => {
  if (command !== "start_ask_assistant_stream") {
    return null;
  }

  const requestId = payload?.input?.requestId ?? "ask-test";
  queueMicrotask(() => {
    emit("assistant:started", {
      requestId,
      sessionId: "session-1",
      prompt: "What should I say?",
      startedAt: "2026-03-13T09:00:00Z",
      requestedScreenContext: true,
    });
    emit("assistant:chunk", {
      requestId,
      sessionId: "session-1",
      delta: "Say the rollback guardrail ",
      content: "Say the rollback guardrail ",
    });
    emit("assistant:completed", {
      requestId,
      sessionId: "session-1",
      detail: {
        session: {
          id: "session-1",
          title: "Weekly sync",
          status: "active",
          startedAt: null,
          endedAt: null,
          captureMode: "manual",
          captureTargetKind: null,
          captureTargetLabel: null,
          updatedAt: "2026-03-13T09:00:01Z",
          rollingSummary: null,
          finalSummary: null,
          decisionsMd: null,
          actionItemsMd: null,
          followUpEmailMd: null,
          notesMd: null,
          ticketGenerationState: "not_started",
          ticketGenerationError: null,
          ticketGeneratedAt: null,
        },
        transcripts: [],
        speakers: [],
        messages: [],
        generatedTickets: [],
      },
    });
  });

  return { requestId };
});

function emit(eventName: string, payload: unknown) {
  for (const listener of listeners.get(eventName) ?? []) {
    listener({ payload });
  }
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
    const current = listeners.get(eventName) ?? [];
    current.push(callback);
    listeners.set(eventName, current);
    return () => {
      listeners.set(
        eventName,
        (listeners.get(eventName) ?? []).filter((listener) => listener !== callback)
      );
    };
  }),
}));

describe("streamAskAssistant", () => {
  beforeEach(() => {
    listeners.clear();
    invokeMock.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("subscribes to assistant events and resolves when the stream completes", async () => {
    const { streamAskAssistant } = await import("../lib/tauri");
    const events: string[] = [];

    const detail = await streamAskAssistant(
      {
        sessionId: "session-1",
        prompt: "What should I say?",
        screenCaptureWaitMs: 180,
      },
      {
        onStarted: () => events.push("started"),
        onChunk: () => events.push("chunk"),
        onCompleted: () => events.push("completed"),
      }
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "start_ask_assistant_stream",
      expect.objectContaining({
        input: expect.objectContaining({
          sessionId: "session-1",
          prompt: "What should I say?",
          screenCaptureWaitMs: 180,
        }),
      })
    );
    expect(events).toEqual(["started", "chunk", "completed"]);
    expect(detail?.session.id).toBe("session-1");
  });
});
