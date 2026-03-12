import { useState } from "react";
import type { ScreenShareState } from "../lib/types";

interface AskBarProps {
  disabled: boolean;
  screenContextEnabled: boolean;
  screenShareState: ScreenShareState;
  onAsk: (prompt: string) => Promise<void>;
}

function screenSummary(screenContextEnabled: boolean, screenShareState: ScreenShareState): string {
  if (!screenContextEnabled) {
    return "Transcript grounded";
  }
  if (screenShareState === "active") {
    return "Transcript + shared screen";
  }
  if (screenShareState === "error") {
    return "Transcript grounded";
  }
  return "Transcript grounded";
}

export function AskBar({ disabled, screenContextEnabled, screenShareState, onAsk }: AskBarProps) {
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
          disabled={disabled}
        />
        <button
          type="button"
          disabled={disabled || prompt.trim().length === 0}
          onClick={async () => {
            await onAsk(prompt);
            setPrompt("");
          }}
        >
          Ask TPMCluely
        </button>
      </div>
    </article>
  );
}
