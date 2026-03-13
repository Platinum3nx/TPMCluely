import { invoke } from "@tauri-apps/api/core";
import {
  appendMockTranscriptSegment,
  askMockAssistant,
  bootstrapMockApp,
  completeMockSession,
  deleteMockKnowledgeFile,
  deleteMockPrompt,
  exportMockSession,
  getMockRuntimeState,
  getMockSessionDetail,
  getMockSecretValue,
  listMockKnowledgeFiles,
  listMockPrompts,
  listMockSessions,
  markMockGeneratedTicketPushed,
  pauseMockSession,
  replaceMockGeneratedTickets,
  resumeMockSession,
  runMockDynamicAction,
  saveMockKnowledgeFile,
  saveMockPrompt,
  saveMockSecret,
  saveMockSetting,
  searchMockSessions,
  setMockOverlayOpen,
  startMockSession,
} from "./mock-backend";
import type {
  AppendTranscriptInput,
  AskSessionInput,
  BootstrapPayload,
  ExportedSessionPayload,
  KnowledgeFileRecord,
  MarkGeneratedTicketPushedInput,
  PromptRecord,
  RunDynamicActionInput,
  RuntimeSnapshot,
  SaveKnowledgeFileInput,
  SaveGeneratedTicketsInput,
  SavePromptInput,
  SaveSecretInput,
  SaveSettingInput,
  SearchSessionResult,
  SessionDetail,
  SessionRecord,
  SettingRecord,
  SecretKey,
  StartSessionInput,
} from "./types";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function bootstrapApp(): Promise<BootstrapPayload> {
  if (!isTauriRuntime()) {
    return bootstrapMockApp();
  }

  return invoke<BootstrapPayload>("bootstrap_app");
}

export async function saveSetting(input: SaveSettingInput): Promise<SettingRecord[]> {
  if (!isTauriRuntime()) {
    return saveMockSetting(input);
  }

  return invoke<SettingRecord[]>("save_setting", { input });
}

export async function saveSecret(input: SaveSecretInput): Promise<void> {
  if (!isTauriRuntime()) {
    await saveMockSecret(input);
    return;
  }

  await invoke("save_secret", { input });
}

export async function getSecretValue(key: SecretKey): Promise<string | null> {
  if (!isTauriRuntime()) {
    return getMockSecretValue(key);
  }

  return invoke<string | null>("read_secret_value", { key });
}

export async function listSessions(): Promise<SessionRecord[]> {
  if (!isTauriRuntime()) {
    return listMockSessions();
  }

  return invoke<SessionRecord[]>("list_sessions");
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return getMockSessionDetail(sessionId);
  }

  return invoke<SessionDetail | null>("get_session_detail", { sessionId });
}

export async function startSession(input: StartSessionInput): Promise<SessionDetail> {
  if (!isTauriRuntime()) {
    return startMockSession(input);
  }

  return invoke<SessionDetail>("start_session", { input });
}

export async function pauseSession(sessionId: string): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return pauseMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("pause_session", { sessionId });
}

export async function resumeSession(sessionId: string): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return resumeMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("resume_session", { sessionId });
}

export async function completeSession(sessionId: string): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return completeMockSession(sessionId);
  }

  return invoke<SessionDetail | null>("complete_session", { sessionId });
}

export async function appendTranscriptSegment(input: AppendTranscriptInput): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return appendMockTranscriptSegment(input);
  }

  return invoke<SessionDetail | null>("append_transcript_segment", { input });
}

export async function runDynamicAction(input: RunDynamicActionInput): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return runMockDynamicAction(input);
  }

  return invoke<SessionDetail | null>("run_dynamic_action", { input });
}

export async function askAssistant(input: AskSessionInput): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return askMockAssistant(input);
  }

  return invoke<SessionDetail | null>("ask_assistant", { input });
}

export async function saveGeneratedTickets(input: SaveGeneratedTicketsInput): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return replaceMockGeneratedTickets(input);
  }

  return invoke<SessionDetail | null>("save_generated_tickets", { input });
}

export async function markGeneratedTicketPushed(
  input: MarkGeneratedTicketPushedInput
): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return markMockGeneratedTicketPushed(input);
  }

  return invoke<SessionDetail | null>("mark_generated_ticket_pushed", { input });
}

export async function getRuntimeState(): Promise<RuntimeSnapshot> {
  if (!isTauriRuntime()) {
    return getMockRuntimeState();
  }

  return invoke<RuntimeSnapshot>("get_runtime_state");
}

export async function setOverlayOpen(open: boolean): Promise<RuntimeSnapshot> {
  if (!isTauriRuntime()) {
    return setMockOverlayOpen(open);
  }

  return invoke<RuntimeSnapshot>("set_overlay_open", { open });
}

export async function searchSessions(query: string): Promise<SearchSessionResult[]> {
  if (!isTauriRuntime()) {
    return searchMockSessions(query);
  }

  return invoke<SearchSessionResult[]>("search_sessions", { query });
}

export async function exportSessionMarkdown(sessionId: string): Promise<ExportedSessionPayload | null> {
  if (!isTauriRuntime()) {
    return exportMockSession(sessionId);
  }

  return invoke<ExportedSessionPayload | null>("export_session_markdown", { sessionId });
}

export async function listPrompts(): Promise<PromptRecord[]> {
  if (!isTauriRuntime()) {
    return listMockPrompts();
  }

  return invoke<PromptRecord[]>("list_system_prompts");
}

export async function savePrompt(input: SavePromptInput): Promise<PromptRecord[]> {
  if (!isTauriRuntime()) {
    return saveMockPrompt(input);
  }

  return invoke<PromptRecord[]>("save_system_prompt", { input });
}

export async function deletePrompt(promptId: string): Promise<PromptRecord[]> {
  if (!isTauriRuntime()) {
    return deleteMockPrompt(promptId);
  }

  return invoke<PromptRecord[]>("delete_system_prompt", { promptId });
}

export async function listKnowledgeFiles(): Promise<KnowledgeFileRecord[]> {
  if (!isTauriRuntime()) {
    return listMockKnowledgeFiles();
  }

  return invoke<KnowledgeFileRecord[]>("list_knowledge_files");
}

export async function saveKnowledgeFile(input: SaveKnowledgeFileInput): Promise<KnowledgeFileRecord[]> {
  if (!isTauriRuntime()) {
    return saveMockKnowledgeFile(input);
  }

  return invoke<KnowledgeFileRecord[]>("save_knowledge_file", { input });
}

export async function deleteKnowledgeFile(knowledgeFileId: string): Promise<KnowledgeFileRecord[]> {
  if (!isTauriRuntime()) {
    return deleteMockKnowledgeFile(knowledgeFileId);
  }

  return invoke<KnowledgeFileRecord[]>("delete_knowledge_file", { knowledgeFileId });
}
