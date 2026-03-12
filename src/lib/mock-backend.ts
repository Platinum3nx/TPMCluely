import type {
  BootstrapPayload,
  PermissionSnapshot,
  SaveSecretInput,
  SaveSettingInput,
  SecretKey,
  SettingRecord,
} from "./types";

const SETTINGS_KEY = "cluely.desktop.settings";
const SECRETS_KEY = "cluely.desktop.secrets";

const defaultSettings: SettingRecord[] = [
  { key: "theme", value: "system" },
  { key: "session_widget_enabled", value: "true" },
  { key: "always_on_top", value: "true" },
  { key: "dock_icon", value: "true" },
  { key: "launch_at_login", value: "false" },
  { key: "output_language", value: "en" },
  { key: "audio_language", value: "auto" },
  { key: "live_summary_enabled", value: "true" },
  { key: "screenshot_mode", value: "selection" },
  { key: "screenshot_processing", value: "manual" },
  { key: "ticket_generation_enabled", value: "true" },
];

const defaultPermissions: PermissionSnapshot = {
  screenRecording: "unknown",
  microphone: "unknown",
  accessibility: "unknown",
};

type SecretMap = Partial<Record<SecretKey, string>>;

function readSettings(): SettingRecord[] {
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaultSettings));
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(raw) as SettingRecord[];
    return Array.isArray(parsed) ? parsed : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function writeSettings(settings: SettingRecord[]): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function readSecrets(): SecretMap {
  const raw = window.localStorage.getItem(SECRETS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as SecretMap;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: SecretMap): void {
  window.localStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
}

export async function bootstrapMockApp(): Promise<BootstrapPayload> {
  const settings = readSettings();
  const secrets = readSecrets();

  return {
    appName: "Cluely Desktop",
    appVersion: "0.1.0-mock",
    permissions: defaultPermissions,
    settings,
    secrets: {
      geminiConfigured: Boolean(secrets.gemini_api_key),
      deepgramConfigured: Boolean(secrets.deepgram_api_key),
      linearConfigured: Boolean(secrets.linear_api_key && secrets.linear_team_id),
    },
    providers: {
      llmProvider: "Gemini",
      sttProvider: "Deepgram",
      ticketProvider: "Gemini + Linear",
      llmReady: Boolean(secrets.gemini_api_key),
      sttReady: Boolean(secrets.deepgram_api_key),
      linearReady: Boolean(secrets.linear_api_key && secrets.linear_team_id),
    },
    diagnostics: {
      mode: "browser-mock",
      buildTarget: "web",
      keychainAvailable: false,
      databaseReady: true,
      stateMachineReady: true,
    },
  };
}

export async function saveMockSetting(input: SaveSettingInput): Promise<SettingRecord[]> {
  const settings = readSettings();
  const existingIndex = settings.findIndex((setting) => setting.key === input.key);

  if (existingIndex >= 0) {
    settings[existingIndex] = { key: input.key, value: input.value };
  } else {
    settings.push({ key: input.key, value: input.value });
  }

  writeSettings(settings);
  return settings;
}

export async function saveMockSecret(input: SaveSecretInput): Promise<void> {
  const secrets = readSecrets();
  secrets[input.key] = input.value;
  writeSecrets(secrets);
}
