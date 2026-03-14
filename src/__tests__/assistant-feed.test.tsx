import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantFeed } from "../components/AssistantFeed";

describe("AssistantFeed", () => {
  it("renders a streaming draft without showing the empty state", () => {
    render(
      <AssistantFeed
        draft={{
          requestId: "ask-1",
          sessionId: "session-1",
          prompt: "What should I say?",
          content: "Say the rollback guardrail is still pending review.",
          startedAt: "2026-03-13T09:00:00Z",
          requestedScreenContext: true,
        }}
        messages={[]}
      />
    );

    expect(screen.queryByText("No assistant output yet")).not.toBeInTheDocument();
    expect(screen.getByText("Drafting answer")).toBeInTheDocument();
    expect(screen.getByText("Screen requested")).toBeInTheDocument();
    expect(screen.getByText("Say the rollback guardrail is still pending review.")).toBeInTheDocument();
  });
});
