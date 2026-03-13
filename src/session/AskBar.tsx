import { useState } from "react";
import type { ScreenShareState } from "../lib/types";

interface AskBarProps {
  disabled: boolean;
  isLoading?: boolean;
  lastError?: string | null;
  onAsk: (prompt: string) => Promise<void>;
  onRetry?: () => Promise<void>;
  screenContextEnabled: boolean;
  screenShareState: ScreenShareState;
}

function screenSummary(screenContextEnabled: boolean, screenShareState: ScreenShareState): string {
  if (!screenContextEnabled) {
    return "Transcript only";
  }
  if (screenShareState === "active") {
    return "Transcript + shared screen";
  }
  return "Transcript only";
}

export function AskBar({
  disabled,
  isLoading = false,
  lastError = null,
  onAsk,
  onRetry,
  screenContextEnabled,
  screenShareState,
}: AskBarProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Ask TPMCluely</p>
        <span className="section-meta">{screenSummary(screenContextEnabled, screenShareState)}</span>
      </div>
      <div className="field-row">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should I say about the auth rollout risk?"
          disabled={disabled || isLoading}
        />
        <button
          type="button"
          disabled={disabled || isLoading || prompt.trim().length === 0}
          onClick={async () => {
            await onAsk(prompt);
            setPrompt("");
          }}
        >
          {isLoading ? "Answering..." : "Ask TPMCluely"}
        </button>
      </div>
      {lastError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Assistant request failed</strong>
          <p>{lastError}</p>
          {onRetry ? (
            <div className="toolbar-row">
              <button type="button" className="secondary-button" disabled={isLoading} onClick={() => void onRetry()}>
                Retry last request
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
