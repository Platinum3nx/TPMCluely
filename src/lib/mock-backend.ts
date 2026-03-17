import type {
  AppendTranscriptInput,
  AskSessionInput,
  AskSessionStreamInput,
  AssistantChunkEvent,
  AssistantCompletedEvent,
  AssistantFailedEvent,
  AssistantStartedEvent,
  BrowserCaptureSessionUpdateInput,
  BootstrapPayload,
  CaptureCapabilities,
  CaptureStatePayload,
  ChatMessage,
  DynamicActionKey,
  ExportedSessionPayload,
  GeneratedTicket,
  KnowledgeFileRecord,
  MarkGeneratedTicketPushedInput,
  MessageAttachment,
  MessageMetadata,
  PreflightModeState,
  PreflightReport,
  PermissionSnapshot,
  PromptRecord,
  PushGeneratedTicketInput,
  RenameSessionSpeakerInput,
  RepoCitation,
  RepoContext,
  RepoSearchStatus,
  RepoSyncStatus,
  RunDynamicActionInput,
  RuntimeSnapshot,
  SaveKnowledgeFileInput,
  SessionDetail,
  SessionRecord,
  SearchMode,
  SearchSessionResult,
  ScreenContextInput,
  SaveGeneratedTicketsInput,
  SavePromptInput,
  SaveSecretInput,
  SaveSettingInput,
  SecretKey,
  SessionSpeaker,
  SetGeneratedTicketReviewStateInput,
  SettingRecord,
  StartSystemAudioCaptureInput,
  UpdateGeneratedTicketDraftInput,
  StartSessionInput,
  SystemAudioSourceListPayload,
  TranscriptSegment,
  InsightsPayload,
} from "./types";
import { buildSessionMarkdown } from "./export";
import { generateTicketsFromSession } from "./ticket-engine";

const SETTINGS_KEY = "cluely.desktop.settings";
const SECRETS_KEY = "cluely.desktop.secrets";
const SESSIONS_KEY = "cluely.desktop.sessions";
const TRANSCRIPTS_KEY = "cluely.desktop.transcripts";
const SESSION_SPEAKERS_KEY = "cluely.desktop.session-speakers";
const MESSAGES_KEY = "cluely.desktop.messages";
const GENERATED_TICKETS_KEY = "cluely.desktop.generated-tickets";
const PROMPTS_KEY = "cluely.desktop.prompts";
const KNOWLEDGE_FILES_KEY = "cluely.desktop.knowledge-files";
const RUNTIME_KEY = "cluely.desktop.runtime";
const REPO_STATUS_KEY = "cluely.desktop.repo-status";

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
  { key: "screen_context_enabled", value: "true" },
  { key: "persist_screen_artifacts", value: "false" },
  { key: "ticket_generation_enabled", value: "true" },
  { key: "auto_generate_tickets", value: "true" },
  { key: "auto_push_linear", value: "false" },
  { key: "ticket_push_mode", value: "review_before_push" },
  { key: "preferred_microphone_device_id", value: "" },
  { key: "overlay_shortcut", value: "CmdOrCtrl+Shift+K" },
  { key: "github_repo", value: "" },
  { key: "github_branch", value: "main" },
  { key: "repo_live_search_enabled", value: "true" },
];

const defaultPermissions: PermissionSnapshot = {
  screenRecording: "unknown",
  microphone: "unknown",
  accessibility: "unknown",
};

const mockCaptureCapabilities: CaptureCapabilities = {
  nativeSystemAudio: false,
  screenRecordingRequired: true,
  microphoneFallback: true,
};
const MOCK_ASK_STREAM_CHUNK_DELAY_MS = 40;
const semanticSynonyms: Record<string, string[]> = {
  action: ["follow-up", "next", "task"],
  bug: ["issue", "defect", "incident"],
  latency: ["slow", "performance"],
  owner: ["driver", "responsible"],
  permission: ["access", "approval"],
  rollout: ["launch", "ship", "deploy"],
  rollback: ["revert", "backout"],
  summary: ["recap", "overview"],
};

interface MockAskStreamHandlers {
  onChunk?: (event: AssistantChunkEvent) => void;
  onCompleted?: (event: AssistantCompletedEvent) => void;
  onFailed?: (event: AssistantFailedEvent) => void;
  onStarted?: (event: AssistantStartedEvent) => void;
}

type SecretMap = Partial<Record<SecretKey, string>>;

interface DerivedSessionArtifacts {
  rollingSummary: string;
  finalSummary: string;
  decisionsMd: string;
  actionItemsMd: string;
  followUpEmailMd: string;
  notesMd: string;
}

interface RuntimeState {
  session: RuntimeSnapshot["session"];
  window: RuntimeSnapshot["window"];
}

const defaultRepoStatus: RepoSyncStatus = {
  ownerRepo: null,
  branch: "main",
  liveSearchEnabled: true,
  status: "idle",
  lastSyncedCommit: null,
  lastSyncedAt: null,
  currentCommit: null,
  changedFileCount: 0,
  indexedFileCount: 0,
  indexedChunkCount: 0,
  lastError: "No GitHub repo is configured.",
  syncSource: null,
};

function getSettingValue(key: string, fallback: string): string {
  return readSettings().find((setting) => setting.key === key)?.value ?? fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function normalizeManualSpeakerSlug(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "speaker";
}

function defaultProviderDisplayLabel(speakerId: string): string {
  const match = /^dg:(\d+)$/.exec(speakerId);
  if (!match) {
    return "Speaker";
  }

  return `Speaker ${Number(match[1]) + 1}`;
}

function displaySpeakerLabel(label: string | null | undefined): string {
  return label?.trim() || "Unattributed";
}

function transcriptLine(label: string | null | undefined, text: string): string {
  return `${displaySpeakerLabel(label)}: ${text.trim()}`;
}

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

function readSessions(): SessionRecord[] {
  const raw = window.localStorage.getItem(SESSIONS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecord>[];
    return Array.isArray(parsed)
      ? parsed.map((session) => ({
          id: session.id ?? createId("session"),
          title: session.title ?? "Untitled session",
          status: session.status ?? "completed",
          startedAt: session.startedAt ?? null,
          endedAt: session.endedAt ?? null,
          captureMode: session.captureMode ?? "manual",
          captureTargetKind: session.captureTargetKind ?? null,
          captureTargetLabel: session.captureTargetLabel ?? null,
          updatedAt: session.updatedAt ?? nowIso(),
          rollingSummary: session.rollingSummary ?? null,
          finalSummary: session.finalSummary ?? null,
          decisionsMd: session.decisionsMd ?? null,
          actionItemsMd: session.actionItemsMd ?? null,
          followUpEmailMd: session.followUpEmailMd ?? null,
          notesMd: session.notesMd ?? null,
          repoContext: session.repoContext ?? null,
          ticketGenerationState: session.ticketGenerationState ?? "not_started",
          ticketGenerationError: session.ticketGenerationError ?? null,
          ticketGeneratedAt: session.ticketGeneratedAt ?? null,
        }))
      : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionRecord[]): void {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function readRepoStatus(): RepoSyncStatus {
  const raw = window.localStorage.getItem(REPO_STATUS_KEY);
  if (!raw) {
    return defaultRepoStatus;
  }

  try {
    const parsed = JSON.parse(raw) as RepoSyncStatus;
    return { ...defaultRepoStatus, ...parsed };
  } catch {
    return defaultRepoStatus;
  }
}

function writeRepoStatus(status: RepoSyncStatus): void {
  window.localStorage.setItem(REPO_STATUS_KEY, JSON.stringify(status));
}

function readTranscripts(): TranscriptSegment[] {
  const raw = window.localStorage.getItem(TRANSCRIPTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TranscriptSegment>[];
    return Array.isArray(parsed)
      ? parsed.map((segment) => ({
          id: segment.id ?? createId("seg"),
          sessionId: segment.sessionId ?? "",
          sequenceNo: segment.sequenceNo ?? 1,
          speakerId: segment.speakerLabel === "Meeting" ? null : (segment.speakerId ?? null),
          speakerLabel: segment.speakerLabel === "Meeting" ? null : (segment.speakerLabel ?? null),
          speakerConfidence: segment.speakerConfidence ?? null,
          startMs: segment.startMs ?? null,
          endMs: segment.endMs ?? null,
          text: segment.text ?? "",
          isFinal: segment.isFinal ?? true,
          source: segment.source ?? "manual",
          createdAt: segment.createdAt ?? nowIso(),
        }))
      : [];
  } catch {
    return [];
  }
}

function writeTranscripts(segments: TranscriptSegment[]): void {
  window.localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(segments));
}

function readSessionSpeakers(): SessionSpeaker[] {
  const raw = window.localStorage.getItem(SESSION_SPEAKERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionSpeaker>[];
    return Array.isArray(parsed)
      ? parsed
          .filter((speaker): speaker is Partial<SessionSpeaker> & { sessionId: string; speakerId: string } =>
            Boolean(speaker.sessionId && speaker.speakerId)
          )
          .map((speaker) => ({
            sessionId: speaker.sessionId,
            speakerId: speaker.speakerId,
            providerLabel: speaker.providerLabel ?? null,
            displayLabel: speaker.displayLabel?.trim() || defaultProviderDisplayLabel(speaker.speakerId),
            source: speaker.source === "manual" ? "manual" : "provider",
            createdAt: speaker.createdAt ?? nowIso(),
            updatedAt: speaker.updatedAt ?? speaker.createdAt ?? nowIso(),
          }))
      : [];
  } catch {
    return [];
  }
}

function writeSessionSpeakers(speakers: SessionSpeaker[]): void {
  window.localStorage.setItem(SESSION_SPEAKERS_KEY, JSON.stringify(speakers));
}

function readMessages(): ChatMessage[] {
  const raw = window.localStorage.getItem(MESSAGES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChatMessage>[];
    return Array.isArray(parsed)
      ? parsed.map((message) => ({
          id: message.id ?? createId("msg"),
          sessionId: message.sessionId ?? "",
          role: message.role ?? "assistant",
          content: message.content ?? "",
          contextSnapshot: message.contextSnapshot ?? null,
          attachments: Array.isArray(message.attachments) ? message.attachments : [],
          metadata: message.metadata ?? null,
          createdAt: message.createdAt ?? nowIso(),
        }))
      : [];
  } catch {
    return [];
  }
}

function writeMessages(messages: ChatMessage[]): void {
  window.localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

function readGeneratedTickets(): GeneratedTicket[] {
  const raw = window.localStorage.getItem(GENERATED_TICKETS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GeneratedTicket>[];
    return Array.isArray(parsed)
      ? parsed.map((ticket) => ({
          id: ticket.id ?? createId("ticket"),
          sessionId: ticket.sessionId ?? "",
          idempotencyKey: ticket.idempotencyKey ?? createId("ticket-key"),
          title: ticket.title ?? "Untitled ticket",
          description: ticket.description ?? "",
          acceptanceCriteria: Array.isArray(ticket.acceptanceCriteria) ? ticket.acceptanceCriteria : [],
          type: ticket.type ?? "Task",
          sourceLine: ticket.sourceLine ?? null,
          linearIssueId: ticket.linearIssueId ?? null,
          linearIssueKey: ticket.linearIssueKey ?? null,
          linearIssueUrl: ticket.linearIssueUrl ?? null,
          pushedAt: ticket.pushedAt ?? null,
          linearPushState:
            ticket.linearPushState ??
            (ticket.linearIssueId || ticket.pushedAt ? "pushed" : "pending"),
          linearLastError: ticket.linearLastError ?? null,
          linearLastAttemptAt: ticket.linearLastAttemptAt ?? null,
          linearDeduped: ticket.linearDeduped ?? false,
          reviewState: ticket.reviewState ?? (ticket.linearPushState === "pushed" ? "pushed" : "draft"),
          approvedAt: ticket.approvedAt ?? null,
          rejectedAt: ticket.rejectedAt ?? null,
          rejectionReason: ticket.rejectionReason ?? null,
          reviewedAt: ticket.reviewedAt ?? null,
          createdAt: ticket.createdAt ?? nowIso(),
        }))
      : [];
  } catch {
    return [];
  }
}

function writeGeneratedTickets(tickets: GeneratedTicket[]): void {
  window.localStorage.setItem(GENERATED_TICKETS_KEY, JSON.stringify(tickets));
}

function readPrompts(): PromptRecord[] {
  const raw = window.localStorage.getItem(PROMPTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as PromptRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePrompts(prompts: PromptRecord[]): void {
  window.localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
}

function readKnowledgeFiles(): KnowledgeFileRecord[] {
  const raw = window.localStorage.getItem(KNOWLEDGE_FILES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as KnowledgeFileRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeKnowledgeFiles(files: KnowledgeFileRecord[]): void {
  window.localStorage.setItem(KNOWLEDGE_FILES_KEY, JSON.stringify(files));
}

function readRuntimeState(): RuntimeState {
  const raw = window.localStorage.getItem(RUNTIME_KEY);
  if (!raw) {
    return {
      session: {
        activeSessionId: null,
        activeStatus: null,
        lastTransitionAt: null,
      },
      window: {
        overlayOpen: false,
        stealthActive: false,
        lastChangedAt: null,
      },
    };
  }

  try {
    return JSON.parse(raw) as RuntimeState;
  } catch {
    return {
      session: {
        activeSessionId: null,
        activeStatus: null,
        lastTransitionAt: null,
      },
      window: {
        overlayOpen: false,
        stealthActive: false,
        lastChangedAt: null,
      },
    };
  }
}

function writeRuntimeState(runtime: RuntimeState): void {
  window.localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
}

function findSessionSpeakerById(sessionId: string, speakerId: string): SessionSpeaker | undefined {
  return readSessionSpeakers().find((speaker) => speaker.sessionId === sessionId && speaker.speakerId === speakerId);
}

function findSessionSpeakerByLabel(sessionId: string, label: string): SessionSpeaker | undefined {
  const normalized = label.trim().toLowerCase();
  return readSessionSpeakers().find(
    (speaker) => speaker.sessionId === sessionId && speaker.displayLabel.trim().toLowerCase() === normalized
  );
}

function upsertSessionSpeaker(nextSpeaker: SessionSpeaker): SessionSpeaker[] {
  const speakers = readSessionSpeakers().filter(
    (speaker) => !(speaker.sessionId === nextSpeaker.sessionId && speaker.speakerId === nextSpeaker.speakerId)
  );
  speakers.push(nextSpeaker);
  writeSessionSpeakers(
    speakers.sort((left, right) =>
      left.sessionId === right.sessionId
        ? left.createdAt.localeCompare(right.createdAt)
        : left.sessionId.localeCompare(right.sessionId)
    )
  );
  return readSessionSpeakers();
}

function resolveMockTranscriptSpeaker(
  sessionId: string,
  source: TranscriptSegment["source"],
  speakerId?: string | null,
  speakerLabel?: string | null
): { speakerId: string | null; speakerLabel: string | null } {
  const normalizedSpeakerId = speakerId?.trim() || null;
  const normalizedSpeakerLabel = speakerLabel?.trim() || null;

  if (normalizedSpeakerId) {
    const existing = findSessionSpeakerById(sessionId, normalizedSpeakerId);
    if (existing) {
      return { speakerId: existing.speakerId, speakerLabel: existing.displayLabel };
    }

    const createdAt = nowIso();
    const nextSpeaker: SessionSpeaker = {
      sessionId,
      speakerId: normalizedSpeakerId,
      providerLabel: normalizedSpeakerLabel,
      displayLabel: source === "manual" && normalizedSpeakerLabel
        ? normalizedSpeakerLabel
        : defaultProviderDisplayLabel(normalizedSpeakerId),
      source: source === "manual" ? "manual" : "provider",
      createdAt,
      updatedAt: createdAt,
    };
    upsertSessionSpeaker(nextSpeaker);
    return { speakerId: nextSpeaker.speakerId, speakerLabel: nextSpeaker.displayLabel };
  }

  if (source === "manual" && normalizedSpeakerLabel) {
    const existing = findSessionSpeakerByLabel(sessionId, normalizedSpeakerLabel);
    if (existing) {
      return { speakerId: existing.speakerId, speakerLabel: existing.displayLabel };
    }

    const createdAt = nowIso();
    const nextSpeaker: SessionSpeaker = {
      sessionId,
      speakerId: `manual:${normalizeManualSpeakerSlug(normalizedSpeakerLabel)}:${createId("speaker")}`,
      providerLabel: null,
      displayLabel: normalizedSpeakerLabel,
      source: "manual",
      createdAt,
      updatedAt: createdAt,
    };
    upsertSessionSpeaker(nextSpeaker);
    return { speakerId: nextSpeaker.speakerId, speakerLabel: nextSpeaker.displayLabel };
  }

  return { speakerId: null, speakerLabel: null };
}

function backfillLegacySpeakers(sessionId: string, transcripts: TranscriptSegment[]): { speakers: SessionSpeaker[]; transcripts: TranscriptSegment[] } {
  const existingSpeakers = readSessionSpeakers();
  const nextSpeakers = [...existingSpeakers];
  let speakersChanged = false;
  let transcriptsChanged = false;

  const nextTranscripts = transcripts.map((segment) => {
    if (segment.sessionId !== sessionId) {
      return segment;
    }

    if (segment.speakerLabel === "Meeting") {
      transcriptsChanged = true;
      return {
        ...segment,
        speakerId: null,
        speakerLabel: null,
        speakerConfidence: null,
      };
    }

    if (segment.speakerId) {
      const existing = nextSpeakers.find(
        (speaker) => speaker.sessionId === sessionId && speaker.speakerId === segment.speakerId
      );
      if (!existing) {
        const createdAt = segment.createdAt ?? nowIso();
        nextSpeakers.push({
          sessionId,
          speakerId: segment.speakerId,
          providerLabel: segment.speakerLabel,
          displayLabel: segment.speakerLabel?.trim() || defaultProviderDisplayLabel(segment.speakerId),
          source: segment.source === "manual" ? "manual" : "provider",
          createdAt,
          updatedAt: createdAt,
        });
        speakersChanged = true;
      }
      return segment;
    }

    if (!segment.speakerLabel?.trim()) {
      return segment;
    }

    const legacySpeakerId = `legacy:${normalizeManualSpeakerSlug(segment.speakerLabel)}`;
    let speaker = nextSpeakers.find((entry) => entry.sessionId === sessionId && entry.speakerId === legacySpeakerId);
    if (!speaker) {
      const createdAt = segment.createdAt ?? nowIso();
      speaker = {
        sessionId,
        speakerId: legacySpeakerId,
        providerLabel: segment.speakerLabel,
        displayLabel: segment.speakerLabel.trim(),
        source: segment.source === "manual" ? "manual" : "provider",
        createdAt,
        updatedAt: createdAt,
      };
      nextSpeakers.push(speaker);
      speakersChanged = true;
    }

    transcriptsChanged = true;
    return {
      ...segment,
      speakerId: speaker.speakerId,
      speakerLabel: speaker.displayLabel,
    };
  });

  if (speakersChanged) {
    writeSessionSpeakers(nextSpeakers);
  }
  if (transcriptsChanged) {
    writeTranscripts(nextTranscripts);
  }

  return {
    speakers: (speakersChanged ? nextSpeakers : existingSpeakers)
      .filter((speaker) => speaker.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    transcripts: nextTranscripts
      .filter((segment) => segment.sessionId === sessionId)
      .sort((left, right) => left.sequenceNo - right.sequenceNo),
  };
}

function syncRuntimeSession(sessionId: string, status: SessionRecord["status"]): void {
  writeRuntimeState({
    ...readRuntimeState(),
    session: {
      activeSessionId: sessionId,
      activeStatus: status,
      lastTransitionAt: nowIso(),
    },
  });
}

function getSessionDetail(sessionId: string): SessionDetail | null {
  const session = readSessions().find((entry) => entry.id === sessionId);
  if (!session) {
    return null;
  }

  const allTranscripts = readTranscripts();
  const { speakers, transcripts } = backfillLegacySpeakers(sessionId, allTranscripts);

  return {
    session,
    transcripts,
    speakers,
    messages: readMessages()
      .filter((message) => message.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    generatedTickets: readGeneratedTickets()
      .filter((ticket) => ticket.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

function updateSessionRecord(next: SessionRecord): SessionRecord[] {
  const sessions = readSessions();
  const index = sessions.findIndex((session) => session.id === next.id);

  if (index >= 0) {
    sessions[index] = next;
  } else {
    sessions.unshift(next);
  }

  writeSessions(sessions);
  return sessions;
}

function extractLines(detail: SessionDetail): string[] {
  return detail.transcripts.map((segment) => transcriptLine(segment.speakerLabel, segment.text)).filter(Boolean);
}

function toBulletMd(lines: string[]): string {
  if (lines.length === 0) {
    return "- No signal detected yet.";
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

function deriveSummary(detail: SessionDetail): DerivedSessionArtifacts {
  const transcriptLines = extractLines(detail);
  const plainLines = detail.transcripts.map((segment) => segment.text.trim()).filter(Boolean);
  const summaryLines = plainLines.slice(0, 4);
  const decisionLines = transcriptLines.filter((line) => /(decid|agree|plan|ship|rollout|confirm)/i.test(line));
  const actionLines = transcriptLines.filter((line) => /(will|owner|todo|follow-up|task|fix|handle)/i.test(line));

  const rollingSummary =
    summaryLines.length > 0
      ? `This session focused on ${summaryLines.join(" ")}`.replace(/\s+/g, " ").trim()
      : "No transcript signal captured yet.";
  const finalSummary = rollingSummary;

  const decisionsMd = toBulletMd(decisionLines.slice(0, 4));
  const actionItemsMd = toBulletMd(actionLines.slice(0, 5));
  const notesMd = toBulletMd(transcriptLines.slice(0, 6));
  const followUpEmailMd = [
    "Team,",
    "",
    finalSummary,
    "",
    "Decisions",
    decisionsMd,
    "",
    "Next steps",
    actionItemsMd,
  ].join("\n");

  return {
    rollingSummary,
    finalSummary,
    decisionsMd,
    actionItemsMd,
    followUpEmailMd,
    notesMd,
  };
}

function buildScreenAttachment(screenContext?: ScreenContextInput | null): MessageAttachment[] {
  if (!screenContext) {
    return [];
  }

  return [
    {
      kind: "screenshot",
      mimeType: screenContext.mimeType,
      capturedAt: screenContext.capturedAt,
      width: screenContext.width,
      height: screenContext.height,
      sourceLabel: screenContext.sourceLabel,
      persisted: false,
    },
  ];
}

function buildContextSnapshot(screenContext?: ScreenContextInput | null): string | null {
  if (!screenContext) {
    return null;
  }

  return `Screen shared from ${screenContext.sourceLabel} at ${screenContext.capturedAt} (${screenContext.width}x${screenContext.height}, ${screenContext.staleMs}ms stale).`;
}

function buildMockRepoEvidence(detail: SessionDetail, prompt: string): {
  repoSearch: RepoSearchStatus;
  repoCitations: RepoCitation[];
} {
  const repoContext = detail.session.repoContext;
  if (!repoContext) {
    return {
      repoSearch: {
        attempted: false,
        used: false,
        reason: "No repo is pinned to this session.",
      },
      repoCitations: [],
    };
  }

  const wantsCode =
    /event sourc|arch|repo|code|implementation|function|class|service|handler|pipeline|github/i.test(prompt);
  if (!wantsCode) {
    return {
      repoSearch: {
        attempted: true,
        used: false,
        mode: "snapshot",
        repo: repoContext.ownerRepo,
        branch: repoContext.branch,
        snapshotCommit: repoContext.snapshotCommit,
        resolvedCommit: repoContext.snapshotCommit,
        reason: "Repo search found no strong match.",
        resultCount: 0,
        freshness: repoContext.snapshotCommit ? "snapshot" : "unsynced",
      },
      repoCitations: [],
    };
  }

  const commit = repoContext.snapshotCommit ?? "mockhead1";
  const repoCitations: RepoCitation[] = [
    {
      label: "[C1]",
      repo: repoContext.ownerRepo,
      branch: repoContext.branch,
      commit,
      path: "src/architecture/event-store.ts",
      startLine: 18,
      endLine: 46,
      symbolName: "appendEvents",
      source: "snapshot",
      score: 0.82,
      snippet:
        "export async function appendEvents(streamId: string, events: DomainEvent[]) { /* persisted event log drives projections */ }",
      url: `https://github.com/${repoContext.ownerRepo}/blob/${commit}/src/architecture/event-store.ts#L18`,
    },
  ];

  return {
    repoSearch: {
      attempted: true,
      used: true,
      mode: repoContext.liveSearchEnabled ? "hybrid" : "snapshot",
      repo: repoContext.ownerRepo,
      branch: repoContext.branch,
      snapshotCommit: repoContext.snapshotCommit,
      resolvedCommit: commit,
      reason: "Mock repo evidence attached.",
      resultCount: repoCitations.length,
      freshness: repoContext.liveSearchEnabled ? "live_head" : "snapshot",
    },
    repoCitations,
  };
}

function buildMockMetadata(
  responseMode: MessageMetadata["responseMode"],
  content: string,
  options?: {
    firstChunkLatencyMs?: number | null;
    latencyMs?: number | null;
    providerError?: string | null;
    screenCaptureWaitMs?: number | null;
    streamed?: boolean;
    usedScreenContext?: boolean;
    repoCitations?: RepoCitation[];
    repoSearch?: RepoSearchStatus | null;
  }
): MessageMetadata {
  const citations = [
    ...(content.includes("[Screen]") ? ["[Screen]"] : []),
    ...((options?.repoCitations ?? []).map((citation) => citation.label)),
  ];
  return {
    responseMode,
    providerName: "Browser mock",
    providerError: options?.providerError ?? null,
    latencyMs: options?.latencyMs ?? 0,
    streamed: options?.streamed ?? false,
    firstChunkLatencyMs: options?.firstChunkLatencyMs ?? null,
    screenCaptureWaitMs: options?.screenCaptureWaitMs ?? null,
    usedScreenContext: options?.usedScreenContext ?? false,
    citations,
    repoSearch: options?.repoSearch ?? null,
    repoCitations: options?.repoCitations ?? [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildMockAskResponse(detail: SessionDetail, prompt: string): DerivedSessionArtifacts["finalSummary"] {
  const derived = deriveSummary(detail);
  const lowercase = prompt.toLowerCase();

  if (lowercase.includes("decid")) {
    return derived.decisionsMd;
  }
  if (lowercase.includes("next") || lowercase.includes("action")) {
    return derived.actionItemsMd;
  }
  if (lowercase.includes("follow")) {
    return derived.followUpEmailMd;
  }

  return derived.finalSummary;
}

function splitMockAskResponse(content: string): string[] {
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) {
    return [content];
  }

  const chunkSize = Math.max(3, Math.ceil(words.length / 3));
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(`${words.slice(index, index + chunkSize).join(" ")}${index + chunkSize < words.length ? " " : ""}`);
  }
  return chunks;
}

function ticketHasReviewHistory(ticket: GeneratedTicket): boolean {
  return ticket.linearPushState === "pushed" || ticket.reviewState !== "draft" || Boolean(ticket.reviewedAt);
}

function appendAssistantMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
  options?: {
    attachments?: MessageAttachment[];
    contextSnapshot?: string | null;
    metadata?: MessageMetadata | null;
  }
): ChatMessage[] {
  const messages = readMessages();
  messages.push({
    id: createId("msg"),
    sessionId,
    role,
    content,
    contextSnapshot: options?.contextSnapshot ?? null,
    attachments: options?.attachments ?? [],
    metadata: options?.metadata ?? null,
    createdAt: nowIso(),
  });
  writeMessages(messages);
  return messages;
}

function shouldMockTicketGenerationFail(detail: SessionDetail): boolean {
  return (
    detail.session.title.includes("[generate-fail]") ||
    detail.transcripts.some((segment) => segment.text.includes("__mock_ticket_generation_fail__"))
  );
}

function shouldMockLinearPushFail(ticket: GeneratedTicket): boolean {
  return (
    ticket.title.includes("[push-fail]") ||
    ticket.description.includes("__mock_linear_push_fail__")
  );
}

function updateGeneratedTicketRecord(next: GeneratedTicket): GeneratedTicket[] {
  const tickets = readGeneratedTickets();
  const index = tickets.findIndex(
    (ticket) => ticket.sessionId === next.sessionId && ticket.idempotencyKey === next.idempotencyKey
  );

  if (index >= 0) {
    tickets[index] = next;
  } else {
    tickets.push(next);
  }

  writeGeneratedTickets(tickets);
  return tickets;
}

function replaceGeneratedTicketsForSession(sessionId: string, tickets: GeneratedTicket[]): void {
  writeGeneratedTickets([
    ...readGeneratedTickets().filter((ticket) => ticket.sessionId !== sessionId),
    ...tickets,
  ]);
}

function buildMockLinearIssue(ticket: GeneratedTicket): Pick<
  GeneratedTicket,
  "linearIssueId" | "linearIssueKey" | "linearIssueUrl"
> {
  const issueKeySeed = Math.abs(
    `${ticket.sessionId}:${ticket.idempotencyKey}`
      .split("")
      .reduce((sum, character) => sum + character.charCodeAt(0), 0)
  )
    .toString()
    .padStart(4, "0")
    .slice(0, 4);

  return {
    linearIssueId: `linear_${ticket.sessionId}_${ticket.idempotencyKey}`,
    linearIssueKey: `ENG-${issueKeySeed}`,
    linearIssueUrl: `https://linear.app/mock/issue/ENG-${issueKeySeed}`,
  };
}

export async function bootstrapMockApp(): Promise<BootstrapPayload> {
  const settings = readSettings();
  const secrets = readSecrets();
  const prompts = await listMockPrompts();
  const knowledgeFiles = readKnowledgeFiles();
  const runtime = readRuntimeState();
  const repoStatus = readRepoStatus();

  return {
    appName: "TPMCluely",
    appVersion: "0.1.0-mock",
    permissions: defaultPermissions,
    settings,
    secrets: {
      geminiConfigured: Boolean(secrets.gemini_api_key),
      deepgramConfigured: Boolean(secrets.deepgram_api_key),
      linearConfigured: Boolean(secrets.linear_api_key && secrets.linear_team_id),
      githubConfigured: Boolean(secrets.github_pat),
    },
    providers: {
      llmProvider: "Gemini",
      sttProvider: "Deepgram",
      ticketProvider: "Gemini + Linear",
      embeddingProvider: "Gemini Embeddings",
      llmReady: Boolean(secrets.gemini_api_key),
      sttReady: Boolean(secrets.deepgram_api_key),
      linearReady: Boolean(secrets.linear_api_key && secrets.linear_team_id),
      embeddingReady: Boolean(secrets.gemini_api_key),
    },
    diagnostics: {
      mode: "browser-mock",
      buildTarget: "web",
      keychainAvailable: false,
      databaseReady: true,
      stateMachineReady: true,
      windowControllerReady: true,
      searchReady: true,
      semanticSearchReady: Boolean(secrets.gemini_api_key),
      promptLibraryReady: true,
      knowledgeLibraryReady: true,
      exportReady: true,
      permissionDetectionReady: false,
      captureBackend: "browser-media",
      databasePath: "browser-local-storage",
    },
    captureCapabilities: mockCaptureCapabilities,
    runtime,
    prompts,
    knowledgeFiles,
    repoStatus,
  };
}

export async function getMockRepoSyncStatus(): Promise<RepoSyncStatus> {
  return readRepoStatus();
}

export async function syncMockGithubRepo(ownerRepo: string, branch: string): Promise<RepoSyncStatus> {
  const commitSeed = Math.abs(
    `${ownerRepo}:${branch}:${Date.now().toString(36)}`
      .split("")
      .reduce((sum, character) => sum + character.charCodeAt(0), 0)
  )
    .toString(16)
    .padStart(8, "0")
    .slice(0, 8);
  const status: RepoSyncStatus = {
    ownerRepo,
    branch,
    liveSearchEnabled: getSettingValue("repo_live_search_enabled", "true") === "true",
    status: "completed",
    lastSyncedCommit: commitSeed,
    lastSyncedAt: nowIso(),
    currentCommit: commitSeed,
    changedFileCount: 3,
    indexedFileCount: 6,
    indexedChunkCount: 24,
    lastError: null,
    syncSource: "tree",
  };
  writeRepoStatus(status);
  return status;
}

export async function runMockPreflightChecks(): Promise<PreflightReport> {
  const secrets = readSecrets();
  const preferredMicrophoneDeviceId = getSettingValue("preferred_microphone_device_id", "");
  const screenContextEnabled = getSettingValue("screen_context_enabled", "true") === "true";
  const geminiReady = Boolean(secrets.gemini_api_key);
  const deepgramReady = Boolean(secrets.deepgram_api_key);
  const linearReady = Boolean(secrets.linear_api_key && secrets.linear_team_id);
  const microphoneState: PreflightModeState = deepgramReady ? "verification_required" : "blocked";

  return {
    checkedAt: nowIso(),
    checks: [
      {
        key: "desktop_runtime",
        title: "Desktop runtime",
        status: "warning",
        message: "Browser mock mode is active for development and tests.",
      },
      {
        key: "database_ready",
        title: "Session database",
        status: "ready",
        message: "Browser mock storage is ready.",
      },
      {
        key: "keychain_ready",
        title: "Keychain",
        status: "warning",
        message: "Secrets are stored in localStorage in browser mock mode.",
      },
      {
        key: "gemini_key",
        title: "Gemini key",
        status: geminiReady ? "ready" : "warning",
        message: geminiReady ? "Gemini key is configured for mock mode." : "Gemini key is missing. Responses will remain heuristic.",
      },
      {
        key: "gemini_connectivity",
        title: "Gemini connectivity",
        status: geminiReady ? "warning" : "warning",
        message: "Gemini connectivity is not probed in browser mock mode.",
      },
      {
        key: "deepgram_key",
        title: "Deepgram key",
        status: deepgramReady ? "ready" : "blocked",
        message: deepgramReady ? "Deepgram key is configured for mock mode." : "Deepgram key is missing.",
      },
      {
        key: "deepgram_connectivity",
        title: "Deepgram connectivity",
        status: deepgramReady ? "warning" : "blocked",
        message: deepgramReady ? "Deepgram connectivity is not probed in browser mock mode." : "Deepgram connectivity is unavailable without a key.",
      },
      {
        key: "linear_auth",
        title: "Linear auth",
        status: linearReady ? "ready" : "warning",
        message: linearReady ? "Linear credentials are configured for mock mode." : "Linear credentials are missing.",
      },
      {
        key: "linear_team_lookup",
        title: "Linear team lookup",
        status: linearReady ? "warning" : "warning",
        message: "Linear team lookup is not probed in browser mock mode.",
      },
      {
        key: "microphone_permission",
        title: "Microphone permission",
        status: "warning",
        message: "Microphone permission is handled by the browser.",
      },
      {
        key: "screen_recording_permission",
        title: "Screen Recording permission",
        status: "warning",
        message: "Screen context is handled by browser screen-share APIs.",
      },
      {
        key: "preferred_microphone",
        title: "Preferred microphone",
        status: preferredMicrophoneDeviceId ? "ready" : "warning",
        message: preferredMicrophoneDeviceId
          ? "A preferred microphone is saved and will be verified before live capture starts."
          : "No preferred microphone is saved yet.",
        detail: preferredMicrophoneDeviceId || null,
      },
      {
        key: "system_audio_capability",
        title: "System audio capture",
        status: "blocked",
        message: "Native system-audio capture is unavailable in browser mock mode.",
      },
      {
        key: "screen_context",
        title: "Screen context",
        status: screenContextEnabled ? "ready" : "warning",
        message: screenContextEnabled ? "Screen context is enabled for browser screen sharing." : "Screen context is disabled in settings.",
      },
    ],
    modes: [
      {
        mode: "manual",
        canStart: true,
        state: "ready",
        summary: "Manual mode is always available in browser mock mode.",
      },
      {
        mode: "microphone",
        canStart: deepgramReady,
        state: microphoneState,
        summary: deepgramReady
          ? "Microphone mode can start once TPMCluely verifies the selected input in this browser runtime."
          : "Microphone mode is blocked until a Deepgram key is configured.",
      },
      {
        mode: "system_audio",
        canStart: false,
        state: "blocked",
        summary: "System-audio mode is unavailable in browser mock mode.",
      },
    ],
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

export async function getMockSecretValue(key: SecretKey): Promise<string | null> {
  return readSecrets()[key] ?? null;
}

export async function listMockSessions(): Promise<SessionRecord[]> {
  return readSessions().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getMockSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  return getSessionDetail(sessionId);
}

export async function getMockRuntimeState(): Promise<RuntimeSnapshot> {
  return readRuntimeState();
}

export async function setMockOverlayOpen(open: boolean): Promise<RuntimeSnapshot> {
  const current = readRuntimeState();
  const next: RuntimeSnapshot = {
    ...current,
    window: {
      ...current.window,
      overlayOpen: open,
      lastChangedAt: nowIso(),
    },
  };
  writeRuntimeState(next);
  return next;
}

function semanticMatch(text: string, query: string): boolean {
  const normalizedText = text.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 4);
  if (terms.length === 0) {
    return false;
  }

  const matched = terms.filter((term) => {
    if (normalizedText.includes(term)) {
      return true;
    }

    return (semanticSynonyms[term] ?? []).some((alias) => normalizedText.includes(alias));
  });

  return matched.length >= Math.max(1, Math.ceil(terms.length / 2));
}

function matchLabelForField(field: string, retrievalMode: SearchMode): string {
  const prefix = retrievalMode === "hybrid" ? "Hybrid" : "Phrase";
  switch (field) {
    case "title":
      return retrievalMode === "hybrid" ? "Hybrid title match" : "Title phrase";
    case "final_summary":
      return `${prefix} final summary match`;
    case "decisions":
      return `${prefix} decisions match`;
    case "action_items":
      return `${prefix} action items match`;
    case "notes":
      return `${prefix} notes match`;
    default:
      return retrievalMode === "hybrid" ? "Hybrid transcript match" : "Transcript phrase";
  }
}

export async function searchMockSessions(
  query: string,
  mode: SearchMode = "lexical"
): Promise<SearchSessionResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const details = readSessions().map((session) => getSessionDetail(session.id)).filter(Boolean) as SessionDetail[];
  return details
    .map((detail) => {
      const transcriptMatch = detail.transcripts.find((segment) => {
        const line = transcriptLine(segment.speakerLabel, segment.text).toLowerCase();
        return mode === "hybrid" ? semanticMatch(line, normalizedQuery) : line.includes(normalizedQuery);
      });
      const matchedField =
        (mode === "hybrid"
          ? semanticMatch(detail.session.title, normalizedQuery)
          : detail.session.title.toLowerCase().includes(normalizedQuery))
          ? "title"
          : (mode === "hybrid"
              ? semanticMatch(detail.session.finalSummary ?? "", normalizedQuery)
              : detail.session.finalSummary?.toLowerCase().includes(normalizedQuery))
          ? "final_summary"
          : (mode === "hybrid"
              ? semanticMatch(detail.session.decisionsMd ?? "", normalizedQuery)
              : detail.session.decisionsMd?.toLowerCase().includes(normalizedQuery))
            ? "decisions"
            : (mode === "hybrid"
                ? semanticMatch(detail.session.actionItemsMd ?? "", normalizedQuery)
                : detail.session.actionItemsMd?.toLowerCase().includes(normalizedQuery))
              ? "action_items"
              : (mode === "hybrid"
                  ? semanticMatch(detail.session.notesMd ?? "", normalizedQuery)
                  : detail.session.notesMd?.toLowerCase().includes(normalizedQuery))
                ? "notes"
                : transcriptMatch
                  ? "transcript"
                  : null;
      if (!matchedField) {
        return null;
      }

      const snippetSource =
        (transcriptMatch ? transcriptLine(transcriptMatch.speakerLabel, transcriptMatch.text) : null) ??
        detail.session.finalSummary ??
        detail.session.decisionsMd ??
        detail.session.actionItemsMd ??
        detail.session.notesMd ??
        detail.session.title;

      return {
        sessionId: detail.session.id,
        title: detail.session.title,
        status: detail.session.status,
        updatedAt: detail.session.updatedAt,
        snippet: snippetSource.replace(/\s+/g, " ").slice(0, 220),
        matchedField,
        matchLabel: matchLabelForField(matchedField, mode),
        retrievalMode: mode,
        transcriptSequenceStart: transcriptMatch?.sequenceNo ?? null,
        transcriptSequenceEnd: transcriptMatch?.sequenceNo ?? null,
      } satisfies SearchSessionResult;
    })
    .filter((result): result is SearchSessionResult => result !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function exportMockSession(sessionId: string): Promise<ExportedSessionPayload | null> {
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  return {
    sessionId,
    fileName: `${detail.session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "session"}.md`,
    markdown: buildSessionMarkdown(detail),
    artifactId: null,
  };
}

export async function listMockPrompts(): Promise<PromptRecord[]> {
  const activePromptId = readSettings().find((setting) => setting.key === "active_prompt_id")?.value ?? null;
  return readPrompts().map((prompt) => ({
    ...prompt,
    isActive: prompt.id === activePromptId,
  }));
}

export async function saveMockPrompt(input: SavePromptInput): Promise<PromptRecord[]> {
  const prompts = readPrompts();
  const now = nowIso();
  const nextPrompt: PromptRecord = {
    id: input.id ?? createId("prompt"),
    name: input.name.trim(),
    content: input.content.trim(),
    isDefault: input.isDefault ?? false,
    createdAt: prompts.find((prompt) => prompt.id === input.id)?.createdAt ?? now,
    updatedAt: now,
    isActive: false,
  };
  const filtered = prompts.filter((prompt) => prompt.id !== nextPrompt.id).map((prompt) => ({
    ...prompt,
    isDefault: input.isDefault ? false : prompt.isDefault,
  }));
  let nextPrompts = [nextPrompt, ...filtered].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (input.makeActive || nextPrompts.length === 1) {
    nextPrompts = nextPrompts.map((prompt) => ({
      ...prompt,
      isActive: prompt.id === nextPrompt.id,
    }));
    const settings = readSettings();
    const nextSettings = settings.filter((setting) => setting.key !== "active_prompt_id");
    nextSettings.push({ key: "active_prompt_id", value: nextPrompt.id });
    writeSettings(nextSettings);
  }
  writePrompts(nextPrompts);
  return listMockPrompts();
}

export async function deleteMockPrompt(promptId: string): Promise<PromptRecord[]> {
  const prompts = readPrompts().filter((prompt) => prompt.id !== promptId);
  writePrompts(prompts);
  const settings = readSettings().filter((setting) => !(setting.key === "active_prompt_id" && setting.value === promptId));
  writeSettings(settings);
  return listMockPrompts();
}

export async function listMockKnowledgeFiles(): Promise<KnowledgeFileRecord[]> {
  return readKnowledgeFiles();
}

export async function saveMockKnowledgeFile(input: SaveKnowledgeFileInput): Promise<KnowledgeFileRecord[]> {
  const files = readKnowledgeFiles();
  const nextFile: KnowledgeFileRecord = {
    id: createId("knowledge"),
    name: input.name,
    mimeType: input.mimeType,
    sha256: createId("sha"),
    excerpt: input.content.replace(/\s+/g, " ").slice(0, 180),
    createdAt: nowIso(),
  };
  const nextFiles = [nextFile, ...files].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  writeKnowledgeFiles(nextFiles);
  return nextFiles;
}

export async function deleteMockKnowledgeFile(fileId: string): Promise<KnowledgeFileRecord[]> {
  const files = readKnowledgeFiles().filter((file) => file.id !== fileId);
  writeKnowledgeFiles(files);
  return files;
}

export async function startMockSession(input: StartSessionInput): Promise<SessionDetail> {
  const now = nowIso();
  const nextStatus = input.initialStatus ?? "active";
  const repoStatus = readRepoStatus();
  const githubRepo = getSettingValue("github_repo", "");
  const githubBranch = getSettingValue("github_branch", "main");
  const repoContext: RepoContext | null = githubRepo.includes("/")
    ? {
        ownerRepo: githubRepo,
        owner: githubRepo.split("/")[0] ?? "",
        repoName: githubRepo.split("/")[1] ?? "",
        branch: githubBranch,
        snapshotCommit: repoStatus.lastSyncedCommit,
        snapshotSyncedAt: repoStatus.lastSyncedAt,
        liveSearchEnabled: getSettingValue("repo_live_search_enabled", "true") === "true",
      }
    : null;
  const session: SessionRecord = {
    id: createId("session"),
    title: input.title.trim() || "Untitled session",
    status: nextStatus,
    startedAt: now,
    endedAt: null,
    captureMode: input.captureMode ?? "manual",
    captureTargetKind: input.captureTargetKind ?? null,
    captureTargetLabel: input.captureTargetLabel ?? null,
    updatedAt: now,
    rollingSummary: null,
    finalSummary: null,
    decisionsMd: null,
    actionItemsMd: null,
    followUpEmailMd: null,
    notesMd: null,
    repoContext,
    ticketGenerationState: "not_started",
    ticketGenerationError: null,
    ticketGeneratedAt: null,
  };

  updateSessionRecord(session);
  syncRuntimeSession(session.id, nextStatus);
  appendAssistantMessage(
    session.id,
    "system",
    nextStatus === "preparing"
      ? "Session created. Live capture is being verified."
      : "Session started. Transcript capture is ready."
  );

  return getSessionDetail(session.id)!;
}

export async function updateMockBrowserCaptureSession(
  input: BrowserCaptureSessionUpdateInput
): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  updateSessionRecord({
    ...detail.session,
    status: input.status,
    captureMode: input.captureMode ?? detail.session.captureMode,
    captureTargetKind:
      input.captureTargetKind === undefined ? detail.session.captureTargetKind : input.captureTargetKind,
    captureTargetLabel:
      input.captureTargetLabel === undefined ? detail.session.captureTargetLabel : input.captureTargetLabel,
    updatedAt: nowIso(),
  });
  syncRuntimeSession(input.sessionId, input.status);
  return getSessionDetail(input.sessionId);
}

export async function pauseMockSession(sessionId: string): Promise<SessionDetail | null> {
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  updateSessionRecord({
    ...detail.session,
    status: "paused",
    updatedAt: nowIso(),
  });
  writeRuntimeState({
    ...readRuntimeState(),
    session: {
      activeSessionId: sessionId,
      activeStatus: "paused",
      lastTransitionAt: nowIso(),
    },
  });

  return getSessionDetail(sessionId);
}

export async function resumeMockSession(sessionId: string): Promise<SessionDetail | null> {
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  updateSessionRecord({
    ...detail.session,
    status: "active",
    updatedAt: nowIso(),
  });
  writeRuntimeState({
    ...readRuntimeState(),
    session: {
      activeSessionId: sessionId,
      activeStatus: "active",
      lastTransitionAt: nowIso(),
    },
  });

  return getSessionDetail(sessionId);
}

export async function completeMockSession(sessionId: string): Promise<SessionDetail | null> {
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  const derived = deriveSummary(detail);
  updateSessionRecord({
    ...detail.session,
    status: "completed",
    endedAt: nowIso(),
    updatedAt: nowIso(),
    ...derived,
  });
  writeRuntimeState({
    ...readRuntimeState(),
    session: {
      activeSessionId: null,
      activeStatus: "completed",
      lastTransitionAt: nowIso(),
    },
  });
  appendAssistantMessage(sessionId, "assistant", derived.finalSummary, {
    metadata: buildMockMetadata("transcript_fallback", derived.finalSummary),
  });
  let nextDetail = getSessionDetail(sessionId);
  if (!nextDetail) {
    return null;
  }

  if (
    getSettingValue("ticket_generation_enabled", "true") === "true" &&
    getSettingValue("auto_generate_tickets", "true") === "true"
  ) {
    nextDetail = await regenerateMockSessionTickets(sessionId);
  }

  return nextDetail;
}

export async function appendMockTranscriptSegment(input: AppendTranscriptInput): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const segments = readTranscripts();
  const resolvedSpeaker = resolveMockTranscriptSpeaker(
    input.sessionId,
    input.source ?? "manual",
    input.speakerId ?? null,
    input.speakerLabel ?? null
  );
  segments.push({
    id: createId("seg"),
    sessionId: input.sessionId,
    sequenceNo: detail.transcripts.length + 1,
    speakerId: resolvedSpeaker.speakerId,
    speakerLabel: resolvedSpeaker.speakerLabel,
    speakerConfidence: input.speakerConfidence ?? null,
    startMs: null,
    endMs: null,
    text: input.text.trim(),
    isFinal: input.isFinal ?? true,
    source: input.source ?? "manual",
    createdAt: nowIso(),
  });
  writeTranscripts(segments);
  const nextDetail = getSessionDetail(input.sessionId);
  const derived = nextDetail ? deriveSummary(nextDetail) : null;
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ...(derived ?? {}),
  });

  return getSessionDetail(input.sessionId);
}

export async function renameMockSessionSpeaker(input: RenameSessionSpeakerInput): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const normalizedLabel = input.displayLabel.trim();
  if (!normalizedLabel) {
    return detail;
  }

  const speakers = readSessionSpeakers().map((speaker) =>
    speaker.sessionId === input.sessionId && speaker.speakerId === input.speakerId
      ? {
          ...speaker,
          displayLabel: normalizedLabel,
          updatedAt: nowIso(),
        }
      : speaker
  );
  writeSessionSpeakers(speakers);

  const transcripts = readTranscripts().map((segment) =>
    segment.sessionId === input.sessionId && segment.speakerId === input.speakerId
      ? {
          ...segment,
          speakerLabel: normalizedLabel,
        }
      : segment
  );
  writeTranscripts(transcripts);

  const nextDetail = getSessionDetail(input.sessionId);
  if (!nextDetail) {
    return null;
  }

  const derived = deriveSummary(nextDetail);
  updateSessionRecord({
    ...nextDetail.session,
    updatedAt: nowIso(),
    ...derived,
  });

  return getSessionDetail(input.sessionId);
}

export async function regenerateMockSessionTickets(sessionId: string): Promise<SessionDetail | null> {
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  if (detail.generatedTickets.some(ticketHasReviewHistory)) {
    updateSessionRecord({
      ...detail.session,
      updatedAt: nowIso(),
      ticketGenerationState: "failed",
      ticketGenerationError: "Ticket regeneration is only allowed while all generated tickets remain unpushed drafts.",
    });
    appendAssistantMessage(
      sessionId,
      "system",
      "Ticket regeneration is only allowed while all generated tickets remain unpushed drafts.",
      { metadata: buildMockMetadata("transcript_fallback", "Ticket regeneration is only allowed while all generated tickets remain unpushed drafts.") }
    );
    return getSessionDetail(sessionId);
  }

  if (shouldMockTicketGenerationFail(detail)) {
    updateSessionRecord({
      ...detail.session,
      updatedAt: nowIso(),
      ticketGenerationState: "failed",
      ticketGenerationError: "Mock ticket generation failed for this session.",
    });
    appendAssistantMessage(
      sessionId,
      "system",
      "Ticket generation could not finish automatically: Mock ticket generation failed for this session.",
      { metadata: buildMockMetadata("transcript_fallback", "Ticket generation could not finish automatically: Mock ticket generation failed for this session.") }
    );
    return getSessionDetail(sessionId);
  }

  const nextTickets = generateTicketsFromSession(detail).map((ticket) => {
    const existing = detail.generatedTickets.find((entry) => entry.idempotencyKey === ticket.idempotencyKey);
    return {
      ...ticket,
      linearIssueId: existing?.linearIssueId ?? ticket.linearIssueId,
      linearIssueKey: existing?.linearIssueKey ?? ticket.linearIssueKey,
      linearIssueUrl: existing?.linearIssueUrl ?? ticket.linearIssueUrl,
      pushedAt: existing?.pushedAt ?? ticket.pushedAt,
      linearPushState: existing?.linearPushState ?? ticket.linearPushState,
      linearLastError: existing?.linearLastError ?? ticket.linearLastError,
      linearLastAttemptAt: existing?.linearLastAttemptAt ?? ticket.linearLastAttemptAt,
      linearDeduped: existing?.linearDeduped ?? ticket.linearDeduped,
      reviewState: existing?.reviewState ?? ticket.reviewState,
      approvedAt: existing?.approvedAt ?? ticket.approvedAt,
      rejectedAt: existing?.rejectedAt ?? ticket.rejectedAt,
      rejectionReason: existing?.rejectionReason ?? ticket.rejectionReason,
      reviewedAt: existing?.reviewedAt ?? ticket.reviewedAt,
      createdAt: existing?.createdAt ?? ticket.createdAt,
    } satisfies GeneratedTicket;
  });

  replaceGeneratedTicketsForSession(sessionId, nextTickets);
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ticketGenerationState: "succeeded",
    ticketGenerationError: null,
    ticketGeneratedAt: nowIso(),
  });
  appendAssistantMessage(
    sessionId,
    "system",
    nextTickets.length > 0
      ? `Generated ${nextTickets.length} draft ticket(s) from the completed session. Review and approve them before pushing to Linear.`
      : "No engineering tickets were generated from this meeting transcript.",
    {
      metadata: buildMockMetadata(
        "transcript_fallback",
        nextTickets.length > 0
          ? `Generated ${nextTickets.length} draft ticket(s) from the completed session. Review and approve them before pushing to Linear.`
          : "No engineering tickets were generated from this meeting transcript."
      ),
    }
  );

  return getSessionDetail(sessionId);
}

export async function pushMockGeneratedTicket(
  input: PushGeneratedTicketInput
): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const ticket = detail.generatedTickets.find((entry) => entry.idempotencyKey === input.idempotencyKey);
  if (!ticket) {
    return detail;
  }

  if (ticket.linearPushState === "pushed" && ticket.linearIssueId && ticket.linearIssueKey && ticket.linearIssueUrl) {
    return detail;
  }

  if (!["approved", "push_failed"].includes(ticket.reviewState)) {
    return detail;
  }

  const linearConfigured = Boolean(readSecrets().linear_api_key && readSecrets().linear_team_id);
  if (!linearConfigured) {
    updateGeneratedTicketRecord({
      ...ticket,
      linearPushState: "failed",
      linearLastError: "Linear is not configured in the browser mock runtime.",
      linearLastAttemptAt: nowIso(),
      reviewState: "push_failed",
      reviewedAt: ticket.reviewedAt ?? nowIso(),
    });
    return getSessionDetail(input.sessionId);
  }

  if (shouldMockLinearPushFail(ticket)) {
    updateGeneratedTicketRecord({
      ...ticket,
      linearPushState: "failed",
      linearLastError: "Mock Linear push failed for this ticket.",
      linearLastAttemptAt: nowIso(),
      reviewState: "push_failed",
      reviewedAt: ticket.reviewedAt ?? nowIso(),
    });
    return getSessionDetail(input.sessionId);
  }

  const issue = buildMockLinearIssue(ticket);
  updateGeneratedTicketRecord({
    ...ticket,
    ...issue,
    pushedAt: nowIso(),
    linearPushState: "pushed",
    linearLastError: null,
    linearLastAttemptAt: nowIso(),
    linearDeduped: false,
    reviewState: "pushed",
    approvedAt: ticket.approvedAt ?? nowIso(),
    reviewedAt: ticket.reviewedAt ?? nowIso(),
  });

  return getSessionDetail(input.sessionId);
}

export async function pushMockGeneratedTickets(sessionId: string): Promise<SessionDetail | null> {
  let detail = getSessionDetail(sessionId);
  if (!detail) {
    return null;
  }

  let createdCount = 0;
  let failedCount = 0;
  for (const ticket of detail.generatedTickets.filter(
    (entry) => entry.linearPushState !== "pushed" && ["approved", "push_failed"].includes(entry.reviewState)
  )) {
    const previous = ticket.linearPushState;
    detail = await pushMockGeneratedTicket({
      sessionId,
      idempotencyKey: ticket.idempotencyKey,
    });
    if (!detail) {
      return null;
    }
    const nextTicket = detail.generatedTickets.find((entry) => entry.idempotencyKey === ticket.idempotencyKey);
    if (nextTicket?.linearPushState === "pushed" && previous !== "pushed") {
      createdCount += 1;
    } else if (nextTicket?.linearPushState === "failed") {
      failedCount += 1;
    }
  }

  appendAssistantMessage(
    sessionId,
    "system",
    `Generated ${detail.generatedTickets.length} ticket(s) and pushed ${createdCount} to Linear.${failedCount > 0 ? ` ${failedCount} push attempt(s) failed.` : ""}`
  );

  return getSessionDetail(sessionId);
}

export async function replaceMockGeneratedTickets(input: SaveGeneratedTicketsInput): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const now = nowIso();
  const nextTickets: GeneratedTicket[] = input.tickets.map((ticket) => {
    const existing = detail.generatedTickets.find((entry) => entry.idempotencyKey === ticket.idempotencyKey);
    return {
      id: existing?.id ?? createId("ticket"),
      sessionId: input.sessionId,
      idempotencyKey: ticket.idempotencyKey,
      title: ticket.title,
      description: ticket.description,
      acceptanceCriteria: ticket.acceptanceCriteria,
      type: ticket.type,
      sourceLine: ticket.sourceLine ?? null,
      linearIssueId: existing?.linearIssueId ?? null,
      linearIssueKey: existing?.linearIssueKey ?? null,
      linearIssueUrl: existing?.linearIssueUrl ?? null,
      pushedAt: existing?.pushedAt ?? null,
      linearPushState: existing?.linearPushState ?? "pending",
      linearLastError: existing?.linearLastError ?? null,
      linearLastAttemptAt: existing?.linearLastAttemptAt ?? null,
      linearDeduped: existing?.linearDeduped ?? false,
      reviewState: existing?.reviewState ?? "draft",
      approvedAt: existing?.approvedAt ?? null,
      rejectedAt: existing?.rejectedAt ?? null,
      rejectionReason: existing?.rejectionReason ?? null,
      reviewedAt: existing?.reviewedAt ?? null,
      createdAt: existing?.createdAt ?? now,
    };
  });

  writeGeneratedTickets([
    ...readGeneratedTickets().filter((ticket) => ticket.sessionId !== input.sessionId),
    ...nextTickets,
  ]);

  return getSessionDetail(input.sessionId);
}

export async function updateMockGeneratedTicketDraft(
  input: UpdateGeneratedTicketDraftInput
): Promise<SessionDetail | null> {
  const tickets = readGeneratedTickets();
  const index = tickets.findIndex(
    (ticket) => ticket.sessionId === input.sessionId && ticket.idempotencyKey === input.idempotencyKey
  );

  if (index < 0 || tickets[index].linearPushState === "pushed") {
    return getSessionDetail(input.sessionId);
  }

  tickets[index] = {
    ...tickets[index],
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    type: input.type,
    linearPushState: "pending",
    linearLastError: null,
    linearLastAttemptAt: null,
    reviewState: "draft",
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    reviewedAt: nowIso(),
  };

  writeGeneratedTickets(tickets);
  return getSessionDetail(input.sessionId);
}

export async function setMockGeneratedTicketReviewState(
  input: SetGeneratedTicketReviewStateInput
): Promise<SessionDetail | null> {
  const tickets = readGeneratedTickets();
  const index = tickets.findIndex(
    (ticket) => ticket.sessionId === input.sessionId && ticket.idempotencyKey === input.idempotencyKey
  );

  if (index < 0 || tickets[index].linearPushState === "pushed") {
    return getSessionDetail(input.sessionId);
  }

  if (input.reviewState === "approved") {
    tickets[index] = {
      ...tickets[index],
      reviewState: "approved",
      approvedAt: nowIso(),
      rejectedAt: null,
      rejectionReason: null,
      reviewedAt: nowIso(),
    };
  } else if (input.reviewState === "rejected") {
    tickets[index] = {
      ...tickets[index],
      reviewState: "rejected",
      approvedAt: null,
      rejectedAt: nowIso(),
      rejectionReason: input.rejectionReason ?? null,
      reviewedAt: nowIso(),
    };
  } else {
    tickets[index] = {
      ...tickets[index],
      reviewState: "draft",
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      reviewedAt: tickets[index].reviewedAt ?? nowIso(),
    };
  }

  writeGeneratedTickets(tickets);
  return getSessionDetail(input.sessionId);
}

export async function listMockSystemAudioSources(): Promise<SystemAudioSourceListPayload> {
  return {
    sources: [],
    permissionStatus: "restricted",
    message: "Native system audio capture is unavailable in the browser mock runtime.",
  };
}

export async function getMockCaptureStatus(): Promise<CaptureStatePayload> {
  return {
    sessionId: null,
    runtimeState: "unsupported",
    captureMode: "manual",
    sourceLabel: null,
    message: "Native system audio capture is unavailable in the browser mock runtime.",
    permissionStatus: "restricted",
    targetKind: null,
    reconnectAttempt: 0,
  };
}

export async function startMockSystemAudioCapture(
  input: StartSystemAudioCaptureInput
): Promise<CaptureStatePayload> {
  void input;
  return getMockCaptureStatus();
}

export async function stopMockSystemAudioCapture(sessionId: string): Promise<CaptureStatePayload> {
  void sessionId;
  return {
    sessionId: null,
    runtimeState: "idle",
    captureMode: "manual",
    sourceLabel: null,
    message: null,
    permissionStatus: "restricted",
    targetKind: null,
    reconnectAttempt: 0,
  };
}

export async function markMockGeneratedTicketPushed(
  input: MarkGeneratedTicketPushedInput
): Promise<SessionDetail | null> {
  const tickets = readGeneratedTickets();
  const index = tickets.findIndex(
    (ticket) => ticket.sessionId === input.sessionId && ticket.idempotencyKey === input.idempotencyKey
  );

  if (index < 0) {
    return getSessionDetail(input.sessionId);
  }

  tickets[index] = {
    ...tickets[index],
    linearIssueId: input.linearIssueId,
    linearIssueKey: input.linearIssueKey,
    linearIssueUrl: input.linearIssueUrl,
    pushedAt: input.pushedAt ?? nowIso(),
    linearPushState: "pushed",
    linearLastError: null,
    linearLastAttemptAt: input.pushedAt ?? nowIso(),
    linearDeduped: false,
    reviewState: "pushed",
    approvedAt: tickets[index].approvedAt ?? (input.pushedAt ?? nowIso()),
    reviewedAt: tickets[index].reviewedAt ?? (input.pushedAt ?? nowIso()),
  };

  writeGeneratedTickets(tickets);
  return getSessionDetail(input.sessionId);
}

export async function runMockDynamicAction(
  input: RunDynamicActionInput
): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const derived = deriveSummary(detail);
  const contentByAction: Record<DynamicActionKey, string> = {
    summary: derived.finalSummary,
    decisions: derived.decisionsMd,
    next_steps: derived.actionItemsMd,
    follow_up: derived.followUpEmailMd,
  };

  const usesScreen = input.action === "follow_up" && Boolean(input.screenContext);
  const content = usesScreen
    ? `${contentByAction[input.action]}\n\n[Screen] Shared screen context was available and can help refine unresolved implementation questions.`
    : contentByAction[input.action];

  appendAssistantMessage(input.sessionId, "assistant", content, {
    attachments: usesScreen ? buildScreenAttachment(input.screenContext) : [],
    contextSnapshot: usesScreen ? buildContextSnapshot(input.screenContext) : null,
    metadata: buildMockMetadata("transcript_fallback", content, { usedScreenContext: usesScreen }),
  });
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ...derived,
  });

  return getSessionDetail(input.sessionId);
}

export async function askMockAssistant(input: AskSessionInput): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const derived = deriveSummary(detail);
  const repoEvidence = buildMockRepoEvidence(detail, input.prompt);
  const response = `${buildMockAskResponse(detail, input.prompt)}${repoEvidence.repoCitations.length > 0 ? " [C1]" : ""}`;

  appendAssistantMessage(input.sessionId, "user", input.prompt, {
    contextSnapshot: buildContextSnapshot(input.screenContext),
  });
  appendAssistantMessage(input.sessionId, "assistant", response, {
    attachments: buildScreenAttachment(input.screenContext),
    contextSnapshot: buildContextSnapshot(input.screenContext),
    metadata: buildMockMetadata("transcript_fallback", response, {
      screenCaptureWaitMs: input.screenCaptureWaitMs ?? null,
      usedScreenContext: Boolean(input.screenContext),
      repoSearch: repoEvidence.repoSearch,
      repoCitations: repoEvidence.repoCitations,
    }),
  });
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ...derived,
  });

  return getSessionDetail(input.sessionId);
}

export async function streamMockAssistant(
  input: AskSessionStreamInput,
  handlers: MockAskStreamHandlers = {}
): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  if (input.prompt.includes("__mock_stream_fail__")) {
    const error = "Mock Ask stream failed.";
    handlers.onStarted?.({
      requestId: input.requestId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      startedAt: nowIso(),
      requestedScreenContext: Boolean(input.screenContext),
    });
    await delay(MOCK_ASK_STREAM_CHUNK_DELAY_MS);
    handlers.onFailed?.({
      requestId: input.requestId,
      sessionId: input.sessionId,
      error,
    });
    throw new Error(error);
  }

  const derived = deriveSummary(detail);
  const repoEvidence = buildMockRepoEvidence(detail, input.prompt);
  const response = `${buildMockAskResponse(detail, input.prompt)}${repoEvidence.repoCitations.length > 0 ? " [C1]" : ""}`;
  const chunks = splitMockAskResponse(response);
  const startedAt = nowIso();

  appendAssistantMessage(input.sessionId, "user", input.prompt, {
    contextSnapshot: buildContextSnapshot(input.screenContext),
  });

  handlers.onStarted?.({
    requestId: input.requestId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    startedAt,
    requestedScreenContext: Boolean(input.screenContext),
  });

  let streamedContent = "";
  for (const [index, chunk] of chunks.entries()) {
    await delay(MOCK_ASK_STREAM_CHUNK_DELAY_MS);
    streamedContent += chunk;
    handlers.onChunk?.({
      requestId: input.requestId,
      sessionId: input.sessionId,
      delta: chunk,
      content: streamedContent,
    });
    if (index === 0) {
      continue;
    }
  }

  appendAssistantMessage(input.sessionId, "assistant", response, {
    attachments: buildScreenAttachment(input.screenContext),
    contextSnapshot: buildContextSnapshot(input.screenContext),
    metadata: buildMockMetadata("transcript_fallback", response, {
      firstChunkLatencyMs: MOCK_ASK_STREAM_CHUNK_DELAY_MS,
      latencyMs: MOCK_ASK_STREAM_CHUNK_DELAY_MS * chunks.length,
      screenCaptureWaitMs: input.screenCaptureWaitMs ?? null,
      streamed: true,
      usedScreenContext: Boolean(input.screenContext),
      repoSearch: repoEvidence.repoSearch,
      repoCitations: repoEvidence.repoCitations,
    }),
  });
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ...derived,
  });

  const finalDetail = getSessionDetail(input.sessionId);
  handlers.onCompleted?.({
    requestId: input.requestId,
    sessionId: input.sessionId,
    detail: finalDetail,
  });

  return finalDetail;
}

export async function askMockCrossSession(
  input: { prompt: string; currentSessionId?: string }
): Promise<string> {
  const prompt = input.prompt.toLowerCase();

  if (prompt.includes("decision") || prompt.includes("decide")) {
    return 'Based on past sessions, the team decided to use TypeScript for the frontend (Sprint 12 Standup [Past: "Sprint 12 Standup" S4-S6]) and migrate the auth middleware to comply with session token storage requirements ([Past: "Security Review" S12]).';
  }
  if (prompt.includes("blocker") || prompt.includes("block")) {
    return 'Recurring blockers found across sessions: 1) CI pipeline timeouts (mentioned in 3 sessions), 2) Unclear ownership of the auth migration ([Past: "Sprint 11 Retro" S8]).';
  }
  if (prompt.includes("action") || prompt.includes("next step")) {
    return 'From the last 3 sessions, unresolved action items include: schedule the database migration window, finalize API contract with the mobile team, and review the Linear integration ticket flow.';
  }

  return `Based on ${Math.floor(Math.random() * 5) + 2} past sessions, I found relevant context for "${input.prompt}". The team has discussed this topic multiple times, with the most recent mention in the last standup where they agreed to revisit it in the next sprint planning.`;
}

export function getCrossSessionMockInsights(): InsightsPayload {
  return {
    topics: [
      {
        id: "topic-auth-migration",
        topic: "Auth middleware migration",
        representativeSnippet: "We need to rip out the old auth middleware due to compliance requirements.",
        occurrenceCount: 4,
        firstSeenAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        sessions: [
          { sessionId: "mock-1", sessionTitle: "Security Review", sessionDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-2", sessionTitle: "Sprint 12 Planning", sessionDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-3", sessionTitle: "Sprint 12 Standup", sessionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-4", sessionTitle: "Sprint 13 Planning", sessionDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
        ],
      },
      {
        id: "topic-ci-performance",
        topic: "CI pipeline performance",
        representativeSnippet: "Build times are averaging 18 minutes, blocking the team.",
        occurrenceCount: 3,
        firstSeenAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        sessions: [
          { sessionId: "mock-2", sessionTitle: "Sprint 12 Planning", sessionDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-3", sessionTitle: "Sprint 12 Standup", sessionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-5", sessionTitle: "Infra Review", sessionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
        ],
      },
      {
        id: "topic-mobile-api",
        topic: "Mobile API contract",
        representativeSnippet: "Need to finalize the API contract before the mobile team cuts their release branch.",
        occurrenceCount: 2,
        firstSeenAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        sessions: [
          { sessionId: "mock-3", sessionTitle: "Sprint 12 Standup", sessionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-4", sessionTitle: "Sprint 13 Planning", sessionDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
        ],
      },
    ],
    blockers: [
      {
        id: "blocker-ci-timeout",
        description: "CI pipeline timeouts blocking merges",
        occurrenceCount: 3,
        firstMentionedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
        lastMentionedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        resolved: false,
        sessions: [
          { sessionId: "mock-2", sessionTitle: "Sprint 12 Planning", sessionDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-3", sessionTitle: "Sprint 12 Standup", sessionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-5", sessionTitle: "Infra Review", sessionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
        ],
      },
      {
        id: "blocker-auth-ownership",
        description: "No clear owner for auth migration",
        occurrenceCount: 2,
        firstMentionedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        lastMentionedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        resolved: false,
        sessions: [
          { sessionId: "mock-2", sessionTitle: "Sprint 12 Planning", sessionDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
          { sessionId: "mock-3", sessionTitle: "Sprint 12 Standup", sessionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
        ],
      },
    ],
  };
}
