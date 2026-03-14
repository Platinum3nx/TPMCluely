import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  appendMockTranscriptSegment,
  askMockAssistant,
  bootstrapMockApp,
  completeMockSession,
  deleteMockKnowledgeFile,
  deleteMockPrompt,
  exportMockSession,
  getMockCaptureStatus,
  getMockRepoSyncStatus,
  getMockRuntimeState,
  getMockSessionDetail,
  getMockSecretValue,
  listMockKnowledgeFiles,
  listMockPrompts,
  listMockSessions,
  listMockSystemAudioSources,
  markMockGeneratedTicketPushed,
  pauseMockSession,
  pushMockGeneratedTicket,
  pushMockGeneratedTickets,
  regenerateMockSessionTickets,
  renameMockSessionSpeaker,
  replaceMockGeneratedTickets,
  resumeMockSession,
  runMockDynamicAction,
  runMockPreflightChecks,
  saveMockKnowledgeFile,
  saveMockPrompt,
  saveMockSecret,
  saveMockSetting,
  searchMockSessions,
  setMockGeneratedTicketReviewState,
  setMockOverlayOpen,
  syncMockGithubRepo,
  streamMockAssistant,
  startMockSession,
  startMockSystemAudioCapture,
  stopMockSystemAudioCapture,
  updateMockBrowserCaptureSession,
  updateMockGeneratedTicketDraft,
} from "./mock-backend";
import type {
  AppendTranscriptInput,
  AskSessionInput,
  AskAssistantStreamStartPayload,
  AskSessionStreamInput,
  AssistantChunkEvent,
  AssistantCompletedEvent,
  AssistantFailedEvent,
  AssistantStartedEvent,
  BrowserCaptureSessionUpdateInput,
  BootstrapPayload,
  CaptureStatePayload,
  ExportedSessionPayload,
  KnowledgeFileRecord,
  MarkGeneratedTicketPushedInput,
  PreflightReport,
  PromptRecord,
  PushGeneratedTicketInput,
  RenameSessionSpeakerInput,
  RepoSyncStatus,
  RunDynamicActionInput,
  RuntimeSnapshot,
  SaveGeneratedTicketsInput,
  SaveKnowledgeFileInput,
  SavePromptInput,
  SaveSecretInput,
  SaveSettingInput,
  SearchMode,
  SearchSessionResult,
  SecretKey,
  SessionDetail,
  SessionRecord,
  SetGeneratedTicketReviewStateInput,
  SettingRecord,
  StartSessionInput,
  StartSystemAudioCaptureInput,
  StreamingAssistantDraft,
  SystemAudioSourceListPayload,
  UpdateGeneratedTicketDraftInput,
} from "./types";

interface AskAssistantStreamHandlers {
  onChunk?: (event: AssistantChunkEvent) => void;
  onCompleted?: (event: AssistantCompletedEvent) => void;
  onFailed?: (event: AssistantFailedEvent) => void;
  onStarted?: (event: AssistantStartedEvent) => void;
}

function createAskRequestId(): string {
  return `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildStreamingAssistantDraft(
  event: AssistantStartedEvent | StreamingAssistantDraft
): StreamingAssistantDraft {
  if ("content" in event) {
    return event;
  }

  return {
    requestId: event.requestId,
    sessionId: event.sessionId,
    prompt: event.prompt,
    content: "",
    startedAt: event.startedAt,
    requestedScreenContext: event.requestedScreenContext,
  };
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function isBrowserMockEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ENABLE_BROWSER_MOCK === "true";
}

function assertSupportedRuntime(): "tauri" | "browser-mock" {
  if (isTauriRuntime()) {
    return "tauri";
  }

  if (isBrowserMockEnabled()) {
    return "browser-mock";
  }

  throw new Error(
    "TPMCluely requires the native Tauri desktop runtime. Use VITE_ENABLE_BROWSER_MOCK=true only for local UI development and tests."
  );
}

export async function bootstrapApp(): Promise<BootstrapPayload> {
  if (assertSupportedRuntime() === "browser-mock") {
    return bootstrapMockApp();
  }

  return invoke<BootstrapPayload>("bootstrap_app");
}

export async function runPreflightChecks(): Promise<PreflightReport> {
  if (assertSupportedRuntime() === "browser-mock") {
    return runMockPreflightChecks();
  }

  return invoke<PreflightReport>("run_preflight_checks");
}

export async function saveSetting(input: SaveSettingInput): Promise<SettingRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return saveMockSetting(input);
  }

  return invoke<SettingRecord[]>("save_setting", { input });
}

export async function saveSecret(input: SaveSecretInput): Promise<void> {
  if (assertSupportedRuntime() === "browser-mock") {
    await saveMockSecret(input);
    return;
  }

  await invoke("save_secret", { input });
}

export async function getSecretValue(key: SecretKey): Promise<string | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockSecretValue(key);
  }

  return invoke<string | null>("read_secret_value", { key });
}

export async function listSessions(): Promise<SessionRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return listMockSessions();
  }

  return invoke<SessionRecord[]>("list_sessions");
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockSessionDetail(sessionId);
  }

  return invoke<SessionDetail | null>("get_session_detail", { sessionId });
}

export async function listSystemAudioSources(): Promise<SystemAudioSourceListPayload> {
  if (assertSupportedRuntime() === "browser-mock") {
    return listMockSystemAudioSources();
  }

  return invoke<SystemAudioSourceListPayload>("list_system_audio_sources");
}

export async function getCaptureStatus(sessionId: string): Promise<CaptureStatePayload> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockCaptureStatus();
  }

  return invoke<CaptureStatePayload>("get_capture_status", { sessionId });
}

export async function startSession(input: StartSessionInput): Promise<SessionDetail> {
  if (assertSupportedRuntime() === "browser-mock") {
    return startMockSession(input);
  }

  return invoke<SessionDetail>("start_session", { input });
}

export async function updateBrowserCaptureSession(input: BrowserCaptureSessionUpdateInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return updateMockBrowserCaptureSession(input);
  }

  return invoke<SessionDetail | null>("update_browser_capture_session", { input });
}

export async function startSystemAudioCapture(
  input: StartSystemAudioCaptureInput
): Promise<CaptureStatePayload> {
  if (assertSupportedRuntime() === "browser-mock") {
    return startMockSystemAudioCapture(input);
  }

  return invoke<CaptureStatePayload>("start_system_audio_capture", { input });
}

export async function pauseSession(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return pauseMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("pause_session", { sessionId });
}

export async function resumeSession(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return resumeMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("resume_session", { sessionId });
}

export async function stopSystemAudioCapture(sessionId: string): Promise<CaptureStatePayload> {
  if (assertSupportedRuntime() === "browser-mock") {
    return stopMockSystemAudioCapture(sessionId);
  }

  return invoke<CaptureStatePayload>("stop_system_audio_capture", { sessionId });
}

export async function completeSession(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return completeMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("complete_session", { sessionId });
}

export async function appendTranscriptSegment(input: AppendTranscriptInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return appendMockTranscriptSegment(input);
  }

  return invoke<SessionDetail | null>("append_transcript_segment", { input });
}

export async function renameSessionSpeaker(input: RenameSessionSpeakerInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return renameMockSessionSpeaker(input);
  }

  return invoke<SessionDetail | null>("rename_session_speaker", { input });
}

export async function runDynamicAction(input: RunDynamicActionInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return runMockDynamicAction(input);
  }

  return invoke<SessionDetail | null>("run_dynamic_action", { input });
}

export async function askAssistant(input: AskSessionInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return askMockAssistant(input);
  }

  return invoke<SessionDetail | null>("ask_assistant", { input });
}

export async function streamAskAssistant(
  input: AskSessionInput,
  handlers: AskAssistantStreamHandlers = {}
): Promise<SessionDetail | null> {
  const streamInput: AskSessionStreamInput = {
    ...input,
    requestId: createAskRequestId(),
  };

  if (assertSupportedRuntime() === "browser-mock") {
    return streamMockAssistant(streamInput, handlers);
  }

  const requestId = streamInput.requestId;
  let settled = false;
  let resolvePromise: (detail: SessionDetail | null) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const result = new Promise<SessionDetail | null>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = (error) => reject(error);
  });

  const unlisteners = await Promise.all([
    listen<AssistantStartedEvent>("assistant:started", (event) => {
      if (event.payload.requestId !== requestId || settled) {
        return;
      }
      handlers.onStarted?.(event.payload);
    }),
    listen<AssistantChunkEvent>("assistant:chunk", (event) => {
      if (event.payload.requestId !== requestId || settled) {
        return;
      }
      handlers.onChunk?.(event.payload);
    }),
    listen<AssistantCompletedEvent>("assistant:completed", (event) => {
      if (event.payload.requestId !== requestId || settled) {
        return;
      }
      settled = true;
      handlers.onCompleted?.(event.payload);
      resolvePromise(event.payload.detail);
    }),
    listen<AssistantFailedEvent>("assistant:failed", (event) => {
      if (event.payload.requestId !== requestId || settled) {
        return;
      }
      settled = true;
      handlers.onFailed?.(event.payload);
      rejectPromise(new Error(event.payload.error));
    }),
  ]);

  const cleanup = () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };

  try {
    await invoke<AskAssistantStreamStartPayload>("start_ask_assistant_stream", { input: streamInput });
    return await result.finally(cleanup);
  } catch (error) {
    settled = true;
    cleanup();
    throw error;
  }
}

export async function saveGeneratedTickets(input: SaveGeneratedTicketsInput): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return replaceMockGeneratedTickets(input);
  }

  return invoke<SessionDetail | null>("save_generated_tickets", { input });
}

export async function updateGeneratedTicketDraft(
  input: UpdateGeneratedTicketDraftInput
): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return updateMockGeneratedTicketDraft(input);
  }

  return invoke<SessionDetail | null>("update_generated_ticket_draft", { input });
}

export async function setGeneratedTicketReviewState(
  input: SetGeneratedTicketReviewStateInput
): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return setMockGeneratedTicketReviewState(input);
  }

  return invoke<SessionDetail | null>("set_generated_ticket_review_state", { input });
}

export async function markGeneratedTicketPushed(
  input: MarkGeneratedTicketPushedInput
): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return markMockGeneratedTicketPushed(input);
  }

  return invoke<SessionDetail | null>("mark_generated_ticket_pushed", { input });
}

export async function generateSessionTickets(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return regenerateMockSessionTickets(sessionId);
  }

  return invoke<SessionDetail | null>("generate_session_tickets", { sessionId });
}

export async function pushGeneratedTicket(
  input: PushGeneratedTicketInput
): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return pushMockGeneratedTicket(input);
  }

  return invoke<SessionDetail | null>("push_generated_ticket", { input });
}

export async function pushGeneratedTickets(sessionId: string): Promise<SessionDetail | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return pushMockGeneratedTickets(sessionId);
  }

  return invoke<SessionDetail | null>("push_generated_tickets", { sessionId });
}

export async function getRuntimeState(): Promise<RuntimeSnapshot> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockRuntimeState();
  }

  return invoke<RuntimeSnapshot>("get_runtime_state");
}

export async function getRepoSyncStatus(): Promise<RepoSyncStatus> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockRepoSyncStatus();
  }

  return invoke<RepoSyncStatus>("get_repo_sync_status");
}

export async function setOverlayOpen(open: boolean): Promise<RuntimeSnapshot> {
  if (assertSupportedRuntime() === "browser-mock") {
    return setMockOverlayOpen(open);
  }

  return invoke<RuntimeSnapshot>("set_overlay_open", { open });
}

export async function setStealthMode(enabled: boolean): Promise<RuntimeSnapshot> {
  if (assertSupportedRuntime() === "browser-mock") {
    return getMockRuntimeState();
  }

  return invoke<RuntimeSnapshot>("set_stealth_mode", { enabled });
}

export async function searchSessions(
  query: string,
  mode: SearchMode = "lexical"
): Promise<SearchSessionResult[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return searchMockSessions(query, mode);
  }

  return invoke<SearchSessionResult[]>("search_sessions", { query, mode });
}

export async function exportSessionMarkdown(sessionId: string): Promise<ExportedSessionPayload | null> {
  if (assertSupportedRuntime() === "browser-mock") {
    return exportMockSession(sessionId);
  }

  return invoke<ExportedSessionPayload | null>("export_session_markdown", { sessionId });
}

export async function listPrompts(): Promise<PromptRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return listMockPrompts();
  }

  return invoke<PromptRecord[]>("list_system_prompts");
}

export async function savePrompt(input: SavePromptInput): Promise<PromptRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return saveMockPrompt(input);
  }

  return invoke<PromptRecord[]>("save_system_prompt", { input });
}

export async function deletePrompt(promptId: string): Promise<PromptRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return deleteMockPrompt(promptId);
  }

  return invoke<PromptRecord[]>("delete_system_prompt", { promptId });
}

export async function listKnowledgeFiles(): Promise<KnowledgeFileRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return listMockKnowledgeFiles();
  }

  return invoke<KnowledgeFileRecord[]>("list_knowledge_files");
}

export async function saveKnowledgeFile(input: SaveKnowledgeFileInput): Promise<KnowledgeFileRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return saveMockKnowledgeFile(input);
  }

  return invoke<KnowledgeFileRecord[]>("save_knowledge_file", { input });
}

export async function deleteKnowledgeFile(knowledgeFileId: string): Promise<KnowledgeFileRecord[]> {
  if (assertSupportedRuntime() === "browser-mock") {
    return deleteMockKnowledgeFile(knowledgeFileId);
  }

  return invoke<KnowledgeFileRecord[]>("delete_knowledge_file", { knowledgeFileId });
}

export async function syncGithubRepo(ownerRepo: string, branch: string): Promise<RepoSyncStatus> {
  if (assertSupportedRuntime() === "browser-mock") {
    return syncMockGithubRepo(ownerRepo, branch);
  }

  return invoke<RepoSyncStatus>("sync_github_repo", { ownerRepo, branch });
}
