import type {
  AppendTranscriptInput,
  AskSessionInput,
  BootstrapPayload,
  ChatMessage,
  DynamicActionKey,
  GeneratedTicket,
  MarkGeneratedTicketPushedInput,
  MessageAttachment,
  PermissionSnapshot,
  RunDynamicActionInput,
  SessionDetail,
  SessionRecord,
  ScreenContextInput,
  SaveGeneratedTicketsInput,
  SaveSecretInput,
  SaveSettingInput,
  SecretKey,
  SettingRecord,
  StartSessionInput,
  TranscriptSegment,
} from "./types";

const SETTINGS_KEY = "cluely.desktop.settings";
const SECRETS_KEY = "cluely.desktop.secrets";
const SESSIONS_KEY = "cluely.desktop.sessions";
const TRANSCRIPTS_KEY = "cluely.desktop.transcripts";
const MESSAGES_KEY = "cluely.desktop.messages";
const GENERATED_TICKETS_KEY = "cluely.desktop.generated-tickets";

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
  { key: "auto_push_linear", value: "true" },
  { key: "overlay_shortcut", value: "CmdOrCtrl+Shift+K" },
];

const defaultPermissions: PermissionSnapshot = {
  screenRecording: "unknown",
  microphone: "unknown",
  accessibility: "unknown",
};

type SecretMap = Partial<Record<SecretKey, string>>;

interface DerivedSessionArtifacts {
  rollingSummary: string;
  finalSummary: string;
  decisionsMd: string;
  actionItemsMd: string;
  followUpEmailMd: string;
  notesMd: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
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
    const parsed = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionRecord[]): void {
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function readTranscripts(): TranscriptSegment[] {
  const raw = window.localStorage.getItem(TRANSCRIPTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as TranscriptSegment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTranscripts(segments: TranscriptSegment[]): void {
  window.localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(segments));
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
    const parsed = JSON.parse(raw) as GeneratedTicket[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGeneratedTickets(tickets: GeneratedTicket[]): void {
  window.localStorage.setItem(GENERATED_TICKETS_KEY, JSON.stringify(tickets));
}

function getSessionDetail(sessionId: string): SessionDetail | null {
  const session = readSessions().find((entry) => entry.id === sessionId);
  if (!session) {
    return null;
  }

  return {
    session,
    transcripts: readTranscripts()
      .filter((segment) => segment.sessionId === sessionId)
      .sort((left, right) => left.sequenceNo - right.sequenceNo),
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
  return detail.transcripts.map((segment) => segment.text.trim()).filter(Boolean);
}

function toBulletMd(lines: string[]): string {
  if (lines.length === 0) {
    return "- No signal detected yet.";
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

function deriveSummary(detail: SessionDetail): DerivedSessionArtifacts {
  const lines = extractLines(detail);
  const summaryLines = lines.slice(0, 4);
  const decisionLines = lines.filter((line) => /(decid|agree|plan|ship|rollout|confirm)/i.test(line));
  const actionLines = lines.filter((line) => /(will|owner|todo|follow-up|task|fix|handle)/i.test(line));

  const rollingSummary =
    summaryLines.length > 0
      ? `This session focused on ${summaryLines.join(" ")}`.replace(/\s+/g, " ").trim()
      : "No transcript signal captured yet.";
  const finalSummary = rollingSummary;

  const decisionsMd = toBulletMd(decisionLines.slice(0, 4));
  const actionItemsMd = toBulletMd(actionLines.slice(0, 5));
  const notesMd = toBulletMd(lines.slice(0, 6));
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

function appendAssistantMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
  options?: {
    attachments?: MessageAttachment[];
    contextSnapshot?: string | null;
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
    createdAt: nowIso(),
  });
  writeMessages(messages);
  return messages;
}

export async function bootstrapMockApp(): Promise<BootstrapPayload> {
  const settings = readSettings();
  const secrets = readSecrets();

  return {
    appName: "TPMCluely",
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

export async function getMockSecretValue(key: SecretKey): Promise<string | null> {
  return readSecrets()[key] ?? null;
}

export async function listMockSessions(): Promise<SessionRecord[]> {
  return readSessions().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getMockSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  return getSessionDetail(sessionId);
}

export async function startMockSession(input: StartSessionInput): Promise<SessionDetail> {
  const now = nowIso();
  const session: SessionRecord = {
    id: createId("session"),
    title: input.title.trim() || "Untitled session",
    status: "active",
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    rollingSummary: null,
    finalSummary: null,
    decisionsMd: null,
    actionItemsMd: null,
    followUpEmailMd: null,
    notesMd: null,
  };

  updateSessionRecord(session);
  appendAssistantMessage(session.id, "system", "Session started. Transcript capture is ready.");

  return getSessionDetail(session.id)!;
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
  appendAssistantMessage(sessionId, "assistant", derived.finalSummary);

  return getSessionDetail(sessionId);
}

export async function appendMockTranscriptSegment(input: AppendTranscriptInput): Promise<SessionDetail | null> {
  const detail = getSessionDetail(input.sessionId);
  if (!detail) {
    return null;
  }

  const segments = readTranscripts();
  segments.push({
    id: createId("seg"),
    sessionId: input.sessionId,
    sequenceNo: detail.transcripts.length + 1,
    speakerLabel: input.speakerLabel?.trim() || null,
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
      createdAt: existing?.createdAt ?? now,
    };
  });

  writeGeneratedTickets([
    ...readGeneratedTickets().filter((ticket) => ticket.sessionId !== input.sessionId),
    ...nextTickets,
  ]);

  return getSessionDetail(input.sessionId);
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

  const usesScreen = input.action === "follow_up" && input.screenContext;
  const content = usesScreen
    ? `${contentByAction[input.action]}\n\n[Screen] Shared screen context was available and can help refine unresolved implementation questions.`
    : contentByAction[input.action];

  appendAssistantMessage(input.sessionId, "assistant", content, {
    attachments: usesScreen ? buildScreenAttachment(input.screenContext) : [],
    contextSnapshot: usesScreen ? buildContextSnapshot(input.screenContext) : null,
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
  const prompt = input.prompt.toLowerCase();

  let response = derived.finalSummary;
  if (prompt.includes("decid")) {
    response = derived.decisionsMd;
  } else if (prompt.includes("next") || prompt.includes("action")) {
    response = derived.actionItemsMd;
  } else if (prompt.includes("follow")) {
    response = derived.followUpEmailMd;
  }

  appendAssistantMessage(input.sessionId, "user", input.prompt, {
    contextSnapshot: buildContextSnapshot(input.screenContext),
  });
  appendAssistantMessage(input.sessionId, "assistant", response, {
    attachments: buildScreenAttachment(input.screenContext),
    contextSnapshot: buildContextSnapshot(input.screenContext),
  });
  updateSessionRecord({
    ...detail.session,
    updatedAt: nowIso(),
    ...derived,
  });

  return getSessionDetail(input.sessionId);
}
