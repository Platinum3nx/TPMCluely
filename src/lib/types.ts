export type PermissionStatus = "unknown" | "granted" | "denied" | "restricted";

export interface PermissionSnapshot {
  screenRecording: PermissionStatus;
  microphone: PermissionStatus;
  accessibility: PermissionStatus;
}

export type SettingValue = string;

export interface SettingRecord {
  key: string;
  value: SettingValue;
}

export interface SecretSnapshot {
  geminiConfigured: boolean;
  deepgramConfigured: boolean;
  linearConfigured: boolean;
}

export interface ProviderSnapshot {
  llmProvider: string;
  sttProvider: string;
  ticketProvider: string;
  llmReady: boolean;
  sttReady: boolean;
  linearReady: boolean;
}

export interface DiagnosticsSnapshot {
  mode: "desktop" | "browser-mock";
  buildTarget: string;
  keychainAvailable: boolean;
  databaseReady: boolean;
  stateMachineReady: boolean;
}

export interface BootstrapPayload {
  appName: string;
  appVersion: string;
  permissions: PermissionSnapshot;
  settings: SettingRecord[];
  secrets: SecretSnapshot;
  providers: ProviderSnapshot;
  diagnostics: DiagnosticsSnapshot;
}

export type SecretKey = "gemini_api_key" | "deepgram_api_key" | "linear_api_key" | "linear_team_id";

export interface SaveSecretInput {
  key: SecretKey;
  value: string;
}

export interface SaveSettingInput {
  key: string;
  value: string;
}
