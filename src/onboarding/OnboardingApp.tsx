import type { BootstrapPayload, PermissionSnapshot, SecretKey } from "../lib/types";

interface OnboardingAppProps {
  bootstrap: BootstrapPayload;
  secretDrafts: Record<SecretKey, string>;
  onSecretDraftChange: (key: SecretKey, value: string) => void;
  onSaveSecret: (key: SecretKey) => Promise<void>;
  savingSecretKey: SecretKey | null;
}

const permissionCopy: Array<{ key: keyof PermissionSnapshot; title: string; detail: string }> = [
  {
    key: "screenRecording",
    title: "Screen Recording",
    detail: "Required for system audio capture, screenshot context, and best-effort session assistance.",
  },
  {
    key: "microphone",
    title: "Microphone",
    detail: "Optional for future microphone capture paths and voice-driven workflows.",
  },
  {
    key: "accessibility",
    title: "Accessibility",
    detail: "Needed only for advanced hotkey and window behavior beyond default Tauri capabilities.",
  },
];

const secretFields: Array<{ key: SecretKey; label: string; placeholder: string }> = [
  { key: "gemini_api_key", label: "Gemini API Key", placeholder: "AIza..." },
  { key: "deepgram_api_key", label: "Deepgram API Key", placeholder: "dgr..." },
  { key: "linear_api_key", label: "Linear API Key", placeholder: "lin_api..." },
  { key: "linear_team_id", label: "Linear Team ID", placeholder: "team_..." },
];

function statusLabel(value: string): string {
  if (value === "granted") {
    return "Ready";
  }
  if (value === "denied") {
    return "Blocked";
  }
  if (value === "restricted") {
    return "Restricted";
  }
  return "Pending";
}

export function OnboardingApp({
  bootstrap,
  secretDrafts,
  onSecretDraftChange,
  onSaveSecret,
  savingSecretKey,
}: OnboardingAppProps) {
  return (
    <section className="panel panel-grid">
      <div className="panel-hero">
        <p className="eyebrow">First-Run Control</p>
        <h2>Prepare the desktop shell before we light up live sessions.</h2>
        <p className="muted">
          This onboarding layer is intentionally strict: permissions, provider readiness, Keychain-backed secrets, and
          system diagnostics must be stable before we move into transcript capture.
        </p>
      </div>

      <div className="panel-column">
        <div className="card-stack">
          {permissionCopy.map((permission) => (
            <article className="card permission-card" key={permission.key}>
              <div>
                <p className="card-title">{permission.title}</p>
                <p className="card-detail">{permission.detail}</p>
              </div>
              <span className={`status-chip status-${bootstrap.permissions[permission.key]}`}>
                {statusLabel(bootstrap.permissions[permission.key])}
              </span>
            </article>
          ))}
        </div>

        <article className="card diagnostic-card">
          <p className="card-title">Diagnostics Snapshot</p>
          <div className="diagnostic-grid">
            <div>
              <span className="muted-label">Runtime</span>
              <strong>{bootstrap.diagnostics.mode}</strong>
            </div>
            <div>
              <span className="muted-label">Build</span>
              <strong>{bootstrap.diagnostics.buildTarget}</strong>
            </div>
            <div>
              <span className="muted-label">Database</span>
              <strong>{bootstrap.diagnostics.databaseReady ? "Ready" : "Pending"}</strong>
            </div>
            <div>
              <span className="muted-label">State Machine</span>
              <strong>{bootstrap.diagnostics.stateMachineReady ? "Ready" : "Pending"}</strong>
            </div>
            <div>
              <span className="muted-label">Permission Detection</span>
              <strong>{bootstrap.diagnostics.permissionDetectionReady ? "Partial / Ready" : "Pending"}</strong>
            </div>
            <div>
              <span className="muted-label">Capture Backend</span>
              <strong>{bootstrap.diagnostics.captureBackend}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="panel-column">
        <article className="card">
          <p className="card-title">Provider Keys</p>
          <p className="card-detail">
            Secrets are saved through the backend bridge. In browser mode they are mocked locally so the interface can
            still be exercised while the Tauri layer is under construction.
          </p>
          <div className="form-grid">
            {secretFields.map((field) => (
              <label className="field" key={field.key}>
                <span>{field.label}</span>
                <div className="field-row">
                  <input
                    type="password"
                    value={secretDrafts[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => onSecretDraftChange(field.key, event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => onSaveSecret(field.key)}
                    disabled={savingSecretKey === field.key || secretDrafts[field.key].trim().length === 0}
                  >
                    {savingSecretKey === field.key ? "Saving" : "Store"}
                  </button>
                </div>
              </label>
            ))}
          </div>
        </article>

        <article className="card readiness-card">
          <p className="card-title">Provider Readiness</p>
          <div className="readiness-row">
            <span>Gemini</span>
            <strong>{bootstrap.providers.llmReady ? "Ready" : "Needs Key"}</strong>
          </div>
          <div className="readiness-row">
            <span>Deepgram</span>
            <strong>{bootstrap.providers.sttReady ? "Ready" : "Needs Key"}</strong>
          </div>
          <div className="readiness-row">
            <span>Linear</span>
            <strong>{bootstrap.providers.linearReady ? "Ready" : "Needs Key + Team"}</strong>
          </div>
        </article>
      </div>
    </section>
  );
}
