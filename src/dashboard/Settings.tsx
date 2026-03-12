import type { BootstrapPayload, SettingRecord } from "../lib/types";

interface SettingsProps {
  bootstrap: BootstrapPayload;
  onUpdateSetting: (key: string, value: string) => Promise<void>;
}

const toggleSettings = [
  {
    key: "session_widget_enabled",
    title: "Session Widget",
    description: "Keep the live widget available during active sessions only.",
  },
  {
    key: "always_on_top",
    title: "Always On Top",
    description: "Pin the live widget above meeting windows where the OS allows it.",
  },
  {
    key: "live_summary_enabled",
    title: "Rolling Summary",
    description: "Generate background summary snapshots for lower-latency assistant answers.",
  },
  {
    key: "ticket_generation_enabled",
    title: "Ticket Generation",
    description: "Allow transcript-to-Linear generation inside sessions and session review.",
  },
  {
    key: "auto_generate_tickets",
    title: "Auto Generate Tickets",
    description: "Run Gemini ticket generation automatically when a meeting ends.",
  },
  {
    key: "auto_push_linear",
    title: "Auto Push Linear",
    description: "Push generated tickets to Linear immediately after ticket generation finishes.",
  },
];

function getSetting(settings: SettingRecord[], key: string, fallback: string): string {
  return settings.find((setting) => setting.key === key)?.value ?? fallback;
}

export function Settings({ bootstrap, onUpdateSetting }: SettingsProps) {
  const theme = getSetting(bootstrap.settings, "theme", "system");
  const outputLanguage = getSetting(bootstrap.settings, "output_language", "en");
  const audioLanguage = getSetting(bootstrap.settings, "audio_language", "auto");
  const overlayShortcut = getSetting(bootstrap.settings, "overlay_shortcut", "CmdOrCtrl+Shift+K");

  return (
    <section className="panel panel-settings">
      <div className="panel-hero">
        <p className="eyebrow">System Settings</p>
        <h2>Keep the desktop shell opinionated, local-first, and explicit about what changes sessions.</h2>
      </div>

      <div className="card-grid">
        <article className="card">
          <p className="card-title">General</p>
          <div className="field">
            <span>Theme</span>
            <select value={theme} onChange={(event) => onUpdateSetting("theme", event.target.value)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <span>Output Language</span>
            <select value={outputLanguage} onChange={(event) => onUpdateSetting("output_language", event.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="field">
            <span>Audio Language</span>
            <select value={audioLanguage} onChange={(event) => onUpdateSetting("audio_language", event.target.value)}>
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="field">
            <span>Overlay Shortcut</span>
            <input value={overlayShortcut} onChange={(event) => void onUpdateSetting("overlay_shortcut", event.target.value)} />
          </div>
        </article>

        <article className="card">
          <p className="card-title">Toggles</p>
          <div className="toggle-list">
            {toggleSettings.map((setting) => {
              const value = getSetting(bootstrap.settings, setting.key, "false") === "true";
              return (
                <button
                  type="button"
                  className={`toggle-card ${value ? "toggle-card-on" : ""}`}
                  key={setting.key}
                  onClick={() => onUpdateSetting(setting.key, value ? "false" : "true")}
                >
                  <div>
                    <strong>{setting.title}</strong>
                    <p>{setting.description}</p>
                  </div>
                  <span>{value ? "On" : "Off"}</span>
                </button>
              );
            })}
          </div>
        </article>

        <article className="card">
          <p className="card-title">Provider Readiness</p>
          <div className="readiness-row">
            <span>LLM Provider</span>
            <strong>{bootstrap.providers.llmProvider}</strong>
          </div>
          <div className="readiness-row">
            <span>STT Provider</span>
            <strong>{bootstrap.providers.sttProvider}</strong>
          </div>
          <div className="readiness-row">
            <span>Ticket Provider</span>
            <strong>{bootstrap.providers.ticketProvider}</strong>
          </div>
        </article>
      </div>
    </section>
  );
}
