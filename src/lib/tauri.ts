import { invoke } from "@tauri-apps/api/core";
import {
  appendMockTranscriptSegment,
  askMockAssistant,
  bootstrapMockApp,
  completeMockSession,
  getMockSessionDetail,
  getMockSecretValue,
  listMockSessions,
  markMockGeneratedTicketPushed,
  pauseMockSession,
  replaceMockGeneratedTickets,
  resumeMockSession,
  runMockDynamicAction,
  saveMockSecret,
  saveMockSetting,
  startMockSession,
} from "./mock-backend";
import type {
  AppendTranscriptInput,
  AskSessionInput,
  BootstrapPayload,
  DynamicActionKey,
  MarkGeneratedTicketPushedInput,
  SaveGeneratedTicketsInput,
  SaveSecretInput,
  SaveSettingInput,
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

export async function runDynamicAction(
  sessionId: string,
  action: DynamicActionKey
): Promise<SessionDetail | null> {
  if (!isTauriRuntime()) {
    return runMockDynamicAction(sessionId, action);
  }

  return invoke<SessionDetail | null>("run_dynamic_action", { sessionId, action });
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
