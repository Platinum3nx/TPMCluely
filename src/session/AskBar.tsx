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
        <p className="card-title">Ask the Session</p>
        <span className="section-meta">Prompt with transcript context</span>
      </div>
      <div className="field-row">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What was decided about authentication rollout?"
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
          Ask
        </button>
      </div>
    </article>
  );
}
