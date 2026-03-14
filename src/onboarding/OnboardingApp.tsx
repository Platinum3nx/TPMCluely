import type { BootstrapPayload, PermissionSnapshot, SecretKey } from "../lib/types";

interface OnboardingAppProps {
  bootstrap: BootstrapPayload;
  onSaveSecret: (key: SecretKey) => Promise<void>;
  onSecretDraftChange: (key: SecretKey, value: string) => void;
  savingSecretKey: SecretKey | null;
  secretDrafts: Record<SecretKey, string>;
}

const permissionCopy: Array<{ detail: string; key: keyof PermissionSnapshot; title: string }> = [
  {
    key: "screenRecording",
    title: "Screen Recording",
    detail: "Required for system audio capture, screenshot context, and optional shared-screen grounding.",
  },
  {
    key: "microphone",
    title: "Microphone",
    detail: "Required for the recommended mic-first capture path in real meetings.",
  },
  {
    key: "accessibility",
    title: "Accessibility",
    detail: "Used only for advanced hotkey and window behavior beyond the default desktop shell.",
  },
];

const secretFields: Array<{ key: SecretKey; label: string; placeholder: string }> = [
  { key: "gemini_api_key", label: "Gemini API Key", placeholder: "AIza..." },
  { key: "deepgram_api_key", label: "Deepgram API Key", placeholder: "dgr..." },
  { key: "linear_api_key", label: "Linear API Key", placeholder: "lin_api..." },
  { key: "linear_team_id", label: "Linear Team ID", placeholder: "team_..." },
  { key: "github_pat", label: "GitHub PAT", placeholder: "ghp_..." },
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

function runtimeLabel(mode: BootstrapPayload["diagnostics"]["mode"]): string {
  return mode === "desktop" ? "Desktop runtime" : "Development runtime";
}

export function OnboardingApp({
  bootstrap,
  onSaveSecret,
  onSecretDraftChange,
  savingSecretKey,
  secretDrafts,
}: OnboardingAppProps) {
  return (
    <section className="panel panel-grid">
      <div className="panel-hero">
        <p className="eyebrow">First Run</p>
        <h2>Prepare the desktop app before the first real meeting.</h2>
        <p className="muted">
          TPMCluely expects permissions, provider keys, and the local runtime to be stable before anyone relies on
          in-meeting answers or review-first ticket generation.
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
          <p className="card-title">Desktop Snapshot</p>
          <div className="diagnostic-grid">
            <div>
              <span className="muted-label">Runtime</span>
              <strong>{runtimeLabel(bootstrap.diagnostics.mode)}</strong>
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
              <span className="muted-label">Keychain</span>
              <strong>{bootstrap.diagnostics.keychainAvailable ? "Ready" : "Unavailable"}</strong>
            </div>
            <div>
              <span className="muted-label">Capture Backend</span>
              <strong>{bootstrap.diagnostics.captureBackend}</strong>
            </div>
            <div>
              <span className="muted-label">Native System Audio</span>
              <strong>{bootstrap.captureCapabilities.nativeSystemAudio ? "Available" : "Unavailable"}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="panel-column">
        <article className="card">
          <p className="card-title">Provider Keys</p>
          <p className="card-detail">
            TPMCluely stores provider secrets through the backend bridge so the desktop app can preflight Gemini,
            Deepgram, and Linear before the meeting begins.
          </p>
          <p className="card-detail">
            GitHub PATs should have repo read access and code-search access for the connected engineering repository.
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
                    onClick={() => void onSaveSecret(field.key)}
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
            <strong>{bootstrap.providers.llmReady ? "Ready" : "Needs key"}</strong>
          </div>
          <div className="readiness-row">
            <span>Deepgram</span>
            <strong>{bootstrap.providers.sttReady ? "Ready" : "Needs key"}</strong>
          </div>
          <div className="readiness-row">
            <span>Linear</span>
            <strong>{bootstrap.providers.linearReady ? "Ready" : "Needs key + team"}</strong>
          </div>
          <div className="readiness-row">
            <span>GitHub</span>
            <strong>{bootstrap.secrets.githubConfigured ? "Ready" : "Needs PAT"}</strong>
          </div>
        </article>
      </div>
    </section>
  );
}
