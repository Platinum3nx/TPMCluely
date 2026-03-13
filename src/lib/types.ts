export type PermissionStatus = "unknown" | "granted" | "denied" | "restricted";

export interface PermissionSnapshot {
  screenRecording: PermissionStatus;
  microphone: PermissionStatus;
  accessibility: PermissionStatus;
}

export type SettingValue = string;
export type TicketPushMode = "review_before_push" | "manual_only";

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
  windowControllerReady: boolean;
  searchReady: boolean;
  promptLibraryReady: boolean;
  knowledgeLibraryReady: boolean;
  exportReady: boolean;
  permissionDetectionReady: boolean;
  captureBackend: string;
  databasePath: string;
}

export interface SessionRuntimeSnapshot {
  activeSessionId: string | null;
  activeStatus: SessionStatus | null;
  lastTransitionAt: string | null;
}

export interface WindowRuntimeSnapshot {
  overlayOpen: boolean;
  stealthActive: boolean;
  lastChangedAt: string | null;
}

export interface RuntimeSnapshot {
  session: SessionRuntimeSnapshot;
  window: WindowRuntimeSnapshot;
}

export interface BootstrapPayload {
  appName: string;
  appVersion: string;
  permissions: PermissionSnapshot;
  settings: SettingRecord[];
  secrets: SecretSnapshot;
  providers: ProviderSnapshot;
  diagnostics: DiagnosticsSnapshot;
  captureCapabilities: CaptureCapabilities;
  runtime: RuntimeSnapshot;
  prompts: PromptRecord[];
  knowledgeFiles: KnowledgeFileRecord[];
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
  captureMode: CaptureMode;
  captureTargetKind: SystemAudioSourceKind | null;
  captureTargetLabel: string | null;
  updatedAt: string;
  rollingSummary: string | null;
  finalSummary: string | null;
  decisionsMd: string | null;
  actionItemsMd: string | null;
  followUpEmailMd: string | null;
  notesMd: string | null;
  ticketGenerationState: TicketGenerationState;
  ticketGenerationError: string | null;
  ticketGeneratedAt: string | null;
}

export type TranscriptSource = "manual" | "capture";
export type ScreenShareState = "inactive" | "requesting" | "active" | "error";

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  sequenceNo: number;
  speakerId: string | null;
  speakerLabel: string | null;
  speakerConfidence: number | null;
  startMs: number | null;
  endMs: number | null;
  text: string;
  isFinal: boolean;
  source: TranscriptSource;
  createdAt: string;
}

export interface SessionSpeaker {
  sessionId: string;
  speakerId: string;
  providerLabel: string | null;
  displayLabel: string;
  source: "provider" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface ScreenContextInput {
  mimeType: string;
  dataBase64: string;
  capturedAt: string;
  width: number;
  height: number;
  sourceLabel: string;
  staleMs: number;
}

export interface MessageAttachment {
  kind: "screenshot";
  artifactId?: string;
  mimeType: string;
  capturedAt: string;
  width: number;
  height: number;
  sourceLabel: string;
  persisted: boolean;
}

export type AssistantResponseMode = "gemini" | "transcript_fallback" | "insufficient_transcript";

export interface MessageMetadata {
  responseMode?: AssistantResponseMode | null;
  providerName?: string | null;
  providerError?: string | null;
  latencyMs?: number | null;
  usedScreenContext?: boolean;
  citations?: string[];
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  contextSnapshot: string | null;
  attachments: MessageAttachment[];
  metadata?: MessageMetadata | null;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionRecord;
  transcripts: TranscriptSegment[];
  speakers: SessionSpeaker[];
  messages: ChatMessage[];
  generatedTickets: GeneratedTicket[];
}

export interface SearchSessionResult {
  sessionId: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  snippet: string;
  matchedField: string;
  transcriptSequenceNo: number | null;
}

export interface StartSessionInput {
  title: string;
  initialStatus?: Exclude<SessionStatus, "idle" | "completed" | "finishing" | "finalization_failed">;
  captureMode?: CaptureMode;
  captureTargetKind?: SystemAudioSourceKind | null;
  captureTargetLabel?: string | null;
}

export interface AppendTranscriptInput {
  sessionId: string;
  speakerId?: string | null;
  speakerLabel?: string | null;
  speakerConfidence?: number | null;
  text: string;
  isFinal?: boolean;
  source?: TranscriptSource;
}

export interface RenameSessionSpeakerInput {
  sessionId: string;
  speakerId: string;
  displayLabel: string;
}

export interface AskSessionInput {
  sessionId: string;
  prompt: string;
  screenContext?: ScreenContextInput | null;
}

export type DynamicActionKey = "summary" | "decisions" | "next_steps" | "follow_up";

export interface RunDynamicActionInput {
  sessionId: string;
  action: DynamicActionKey;
  screenContext?: ScreenContextInput | null;
}

export type TicketType = "Bug" | "Feature" | "Task";
export type TicketGenerationState = "not_started" | "succeeded" | "failed";
export type LinearPushState = "pending" | "pushed" | "failed";
export type GeneratedTicketReviewState = "draft" | "approved" | "rejected" | "pushed" | "push_failed";

export type CaptureMode = "system_audio" | "microphone" | "manual";
export type SystemAudioSourceKind = "window" | "display";

export interface SystemAudioSource {
  id: string;
  kind: SystemAudioSourceKind;
  title: string;
  appName: string | null;
  bundleId: string | null;
  sourceLabel: string;
}

export interface SystemAudioSourceListPayload {
  sources: SystemAudioSource[];
  permissionStatus: PermissionStatus;
  message: string | null;
}

export type CaptureRuntimeState =
  | "idle"
  | "permission_blocked"
  | "starting"
  | "connecting"
  | "listening"
  | "degraded"
  | "stopping"
  | "error"
  | "unsupported";

export interface CaptureStatePayload {
  sessionId: string | null;
  runtimeState: CaptureRuntimeState;
  captureMode: CaptureMode | "manual";
  sourceLabel: string | null;
  message: string | null;
  permissionStatus: PermissionStatus | null;
  targetKind: SystemAudioSourceKind | null;
  reconnectAttempt: number;
}

export interface CaptureHealthPayload {
  sessionId: string | null;
  severity: "info" | "warning" | "error";
  droppedFrames: number;
  queueDepth: number;
  reconnectAttempt: number;
  message: string;
}

export interface CaptureCapabilities {
  nativeSystemAudio: boolean;
  screenRecordingRequired: boolean;
  microphoneFallback: boolean;
}

export interface StartSystemAudioCaptureInput {
  sessionId: string;
  sourceId: string;
  sourceKind: SystemAudioSourceKind;
  sourceLabel: string;
}

export interface CapturePartialEventPayload {
  sessionId: string;
  text: string;
}

export interface CaptureSegmentEventPayload {
  sessionId: string;
  session: SessionRecord;
  segment: TranscriptSegment;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
}

export type PreflightCheckStatus = "ready" | "warning" | "blocked";
export type PreflightModeState = "ready" | "verification_required" | "blocked";

export interface PreflightCheck {
  key: string;
  title: string;
  status: PreflightCheckStatus;
  message: string;
  detail?: string | null;
}

export interface PreflightModeReport {
  mode: CaptureMode;
  canStart: boolean;
  state: PreflightModeState;
  summary: string;
}

export interface PreflightReport {
  checkedAt: string;
  checks: PreflightCheck[];
  modes: PreflightModeReport[];
}

export interface BrowserCaptureSessionUpdateInput {
  sessionId: string;
  status: Exclude<SessionStatus, "idle" | "completed" | "finishing" | "finalization_failed" | "paused">;
  captureMode?: Extract<CaptureMode, "microphone">;
  captureTargetKind?: SystemAudioSourceKind | null;
  captureTargetLabel?: string | null;
}

export interface GeneratedTicket {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: TicketType;
  sourceLine: string | null;
  linearIssueId: string | null;
  linearIssueKey: string | null;
  linearIssueUrl: string | null;
  pushedAt: string | null;
  linearPushState: LinearPushState;
  linearLastError: string | null;
  linearLastAttemptAt: string | null;
  linearDeduped: boolean;
  reviewState: GeneratedTicketReviewState;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface GeneratedTicketDraft {
  idempotencyKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: TicketType;
  sourceLine?: string | null;
}

export interface SaveGeneratedTicketsInput {
  sessionId: string;
  tickets: GeneratedTicketDraft[];
}

export interface UpdateGeneratedTicketDraftInput {
  sessionId: string;
  idempotencyKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: TicketType;
}

export interface SetGeneratedTicketReviewStateInput {
  sessionId: string;
  idempotencyKey: string;
  reviewState: Exclude<GeneratedTicketReviewState, "pushed" | "push_failed">;
  rejectionReason?: string | null;
}

export interface MarkGeneratedTicketPushedInput {
  sessionId: string;
  idempotencyKey: string;
  linearIssueId: string;
  linearIssueKey: string;
  linearIssueUrl: string;
  pushedAt?: string;
}

export interface PushGeneratedTicketInput {
  sessionId: string;
  idempotencyKey: string;
}

export interface ExportedSessionPayload {
  sessionId: string;
  fileName: string;
  markdown: string;
  artifactId: string | null;
}

export interface PromptRecord {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface SavePromptInput {
  id?: string;
  name: string;
  content: string;
  isDefault?: boolean;
  makeActive?: boolean;
}

export interface KnowledgeFileRecord {
  id: string;
  name: string;
  mimeType: string;
  sha256: string;
  excerpt: string;
  createdAt: string;
}

export interface SaveKnowledgeFileInput {
  name: string;
  mimeType: string;
  content: string;
}
