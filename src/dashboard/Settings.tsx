import { FileLibrary } from "./FileLibrary";
import { PromptLibrary } from "./PromptLibrary";
import type {
  BootstrapPayload,
  KnowledgeFileRecord,
  PromptRecord,
  SaveKnowledgeFileInput,
  SavePromptInput,
  SettingRecord,
  TicketPushMode,
} from "../lib/types";

interface SettingsProps {
  bootstrap: BootstrapPayload;
  knowledgeFiles: KnowledgeFileRecord[];
  onDeleteKnowledgeFile: (knowledgeFileId: string) => Promise<void>;
  onDeletePrompt: (promptId: string) => Promise<void>;
  onSaveKnowledgeFile: (input: SaveKnowledgeFileInput) => Promise<void>;
  onSavePrompt: (input: SavePromptInput) => Promise<void>;
  onUpdateSetting: (key: string, value: string) => Promise<void>;
  prompts: PromptRecord[];
}

const toggleSettings = [
  {
    key: "stealth_mode",
    title: "Stealth Mode",
    description: "Hide the overlay from screen capture, screen sharing, and recording tools. The window stays visible locally.",
  },
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
    key: "screen_context_enabled",
    title: "Screen Context",
    description: "Allow Ask TPMCluely and follow-up questions to use shared screen context when available.",
  },
  {
    key: "persist_screen_artifacts",
    title: "Persist Screen Artifacts",
    description: "Store the exact screenshot sent to Gemini for debugging and auditability.",
  },
  {
    key: "ticket_generation_enabled",
    title: "Ticket Generation",
    description: "Allow transcript-to-ticket generation inside sessions and session review.",
  },
  {
    key: "auto_generate_tickets",
    title: "Auto Generate Drafts",
    description: "Generate draft tickets automatically when a meeting ends.",
  },
];

function getSetting(settings: SettingRecord[], key: string, fallback: string): string {
  return settings.find((setting) => setting.key === key)?.value ?? fallback;
}

export function Settings({
  bootstrap,
  knowledgeFiles,
  onDeleteKnowledgeFile,
  onDeletePrompt,
  onSaveKnowledgeFile,
  onSavePrompt,
  onUpdateSetting,
  prompts,
}: SettingsProps) {
  const theme = getSetting(bootstrap.settings, "theme", "system");
  const outputLanguage = getSetting(bootstrap.settings, "output_language", "en");
  const audioLanguage = getSetting(bootstrap.settings, "audio_language", "auto");
  const overlayShortcut = getSetting(bootstrap.settings, "overlay_shortcut", "CmdOrCtrl+Shift+K");
  const ticketPushMode = getSetting(bootstrap.settings, "ticket_push_mode", "review_before_push") as TicketPushMode;
  const preferredMicrophoneDeviceId = getSetting(bootstrap.settings, "preferred_microphone_device_id", "");

  return (
    <section className="panel panel-settings">
      <div className="panel-hero">
        <p className="eyebrow">Desktop Settings</p>
        <h2>Keep meeting capture explicit, answers grounded, and ticket push safely review-driven.</h2>
      </div>

      <div className="card-grid">
        <article className="card">
          <p className="card-title">General</p>
          <div className="field">
            <span>Theme</span>
            <select value={theme} onChange={(event) => void onUpdateSetting("theme", event.target.value)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <span>Output Language</span>
            <select value={outputLanguage} onChange={(event) => void onUpdateSetting("output_language", event.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="field">
            <span>Audio Language</span>
            <select value={audioLanguage} onChange={(event) => void onUpdateSetting("audio_language", event.target.value)}>
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
          <p className="card-title">Meeting Defaults</p>
          <div className="field">
            <span>Ticket push mode</span>
            <select value={ticketPushMode} onChange={(event) => void onUpdateSetting("ticket_push_mode", event.target.value)}>
              <option value="review_before_push">Review before push</option>
              <option value="manual_only">Manual only</option>
            </select>
          </div>
          <div className="readiness-row">
            <span>Preferred microphone</span>
            <strong>{preferredMicrophoneDeviceId ? "Saved from Session tab" : "Choose from Session tab"}</strong>
          </div>
          <p className="card-detail">
            Ticket drafts always stay local until they are explicitly approved. Choose the preferred microphone from the
            Session tab so preflight can validate it before the meeting begins.
          </p>
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
                  onClick={() => void onUpdateSetting(setting.key, value ? "false" : "true")}
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

        <article className="card readiness-card">
          <p className="card-title">Provider Readiness</p>
          <div className="readiness-row">
            <span>LLM Provider</span>
            <strong>{bootstrap.providers.llmProvider}</strong>
          </div>
          <div className="readiness-row">
            <span>Speech-to-text</span>
            <strong>{bootstrap.providers.sttProvider}</strong>
          </div>
          <div className="readiness-row">
            <span>Ticket Provider</span>
            <strong>{bootstrap.providers.ticketProvider}</strong>
          </div>
          <div className="readiness-row">
            <span>Linear push</span>
            <strong>{ticketPushMode === "review_before_push" ? "Review required" : "Manual only"}</strong>
          </div>
        </article>

        <PromptLibrary prompts={prompts} onSavePrompt={onSavePrompt} onDeletePrompt={onDeletePrompt} />

        <FileLibrary files={knowledgeFiles} onSaveFile={onSaveKnowledgeFile} onDeleteFile={onDeleteKnowledgeFile} />
      </div>
    </section>
  );
}
