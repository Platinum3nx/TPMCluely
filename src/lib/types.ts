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

export type SessionStatus =
  | "idle"
  | "preparing"
  | "active"
  | "paused"
  | "finishing"
  | "completed"
  | "permission_blocked"
  | "capture_error"
  | "provider_degraded"
  | "finalization_failed";

export interface SessionRecord {
  id: string;
  title: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  finalSummary: string | null;
  decisionsMd: string | null;
  actionItemsMd: string | null;
  followUpEmailMd: string | null;
  notesMd: string | null;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  sequenceNo: number;
  speakerLabel: string | null;
  text: string;
  isFinal: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionRecord;
  transcripts: TranscriptSegment[];
  messages: ChatMessage[];
}

export interface StartSessionInput {
  title: string;
}

export interface AppendTranscriptInput {
  sessionId: string;
  speakerLabel?: string;
  text: string;
  isFinal?: boolean;
}

export interface AskSessionInput {
  sessionId: string;
  prompt: string;
}

export type DynamicActionKey = "summary" | "decisions" | "next_steps" | "follow_up";

export type TicketType = "Bug" | "Feature" | "Task";

export interface GeneratedTicket {
  idempotencyKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: TicketType;
  sourceLine: string;
}
