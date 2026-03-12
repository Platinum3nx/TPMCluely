import { useState } from "react";

interface AskBarProps {
  disabled: boolean;
  onAsk: (prompt: string) => Promise<void>;
}

export function AskBar({ disabled, onAsk }: AskBarProps) {
  const [prompt, setPrompt] = useState("");

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Ask Cluely</p>
        <span className="section-meta">Grounded in the live transcript</span>
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
          Ask Cluely
        </button>
      </div>
    </article>
  );
}
