import type { DynamicActionKey } from "../lib/types";

interface DynamicActionsProps {
  disabled: boolean;
  onRunAction: (action: DynamicActionKey) => Promise<void>;
}

const actions: Array<{ key: DynamicActionKey; label: string; detail: string }> = [
  { key: "summary", label: "Summarize so far", detail: "Generate a crisp snapshot of the meeting." },
  { key: "decisions", label: "What was decided?", detail: "Pull out decisions and confirmed direction." },
  { key: "next_steps", label: "Next steps", detail: "Extract action items and follow-ups." },
  { key: "follow_up", label: "Follow-up questions", detail: "Ask Gemini for grounded questions to push the discussion deeper." },
];

export function DynamicActions({ disabled, onRunAction }: DynamicActionsProps) {
  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Dynamic Actions</p>
        <span className="section-meta">Meeting copilots</span>
      </div>
      <div className="action-grid">
        {actions.map((action) => (
          <button
            type="button"
            className="action-card"
            key={action.key}
            disabled={disabled}
            onClick={() => void onRunAction(action.key)}
          >
            <strong>{action.label}</strong>
            <p>{action.detail}</p>
          </button>
        ))}
      </div>
    </article>
  );
}
