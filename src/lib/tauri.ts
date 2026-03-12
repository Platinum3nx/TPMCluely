import { invoke } from "@tauri-apps/api/core";
import { bootstrapMockApp, saveMockSecret, saveMockSetting } from "./mock-backend";
import type { BootstrapPayload, SaveSecretInput, SaveSettingInput, SettingRecord } from "./types";

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
