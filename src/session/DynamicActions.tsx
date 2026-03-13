import type { DynamicActionKey } from "../lib/types";

interface DynamicActionsProps {
  disabled: boolean;
  inFlightAction?: DynamicActionKey | null;
  lastError?: string | null;
  onRetry?: () => Promise<void>;
  onRunAction: (action: DynamicActionKey) => Promise<void>;
}

const actions: Array<{ key: DynamicActionKey; label: string; detail: string }> = [
  { key: "summary", label: "Summarize so far", detail: "Generate a grounded snapshot of the meeting." },
  { key: "decisions", label: "What was decided?", detail: "Pull out decisions and confirmed direction." },
  { key: "next_steps", label: "Next steps", detail: "Extract action items, owners, and follow-ups." },
  {
    key: "follow_up",
    label: "Follow-up questions",
    detail: "Ask for grounded follow-up questions that help the speaker answer well in the room.",
  },
];

export function DynamicActions({
  disabled,
  inFlightAction = null,
  lastError = null,
  onRetry,
  onRunAction,
}: DynamicActionsProps) {
  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Dynamic Actions</p>
        <span className="section-meta">Grounded meeting copilots</span>
      </div>
      <div className="action-grid">
        {actions.map((action) => {
          const isLoading = inFlightAction === action.key;
          return (
            <button
              type="button"
              className="action-card"
              key={action.key}
              disabled={disabled || inFlightAction !== null}
              onClick={() => void onRunAction(action.key)}
            >
              <strong>{isLoading ? "Running..." : action.label}</strong>
              <p>{action.detail}</p>
            </button>
          );
        })}
      </div>
      {lastError ? (
        <div className="inline-alert inline-alert-soft">
          <strong>Assistant action failed</strong>
          <p>{lastError}</p>
          {onRetry ? (
            <div className="toolbar-row">
              <button type="button" className="secondary-button" disabled={disabled} onClick={() => void onRetry()}>
                Retry last action
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
