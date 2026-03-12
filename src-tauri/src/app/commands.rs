use tauri::State;

use crate::app::state::AppState;
use crate::permissions::PermissionSnapshot;
use crate::providers::ProviderSnapshot;
use crate::secrets::SecretPresence;
use crate::session::state_machine::SessionStateMachine;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub app_name: String,
    pub app_version: String,
    pub permissions: PermissionSnapshot,
    pub settings: Vec<SettingRecord>,
    pub secrets: SecretSnapshot,
    pub providers: ProviderSnapshot,
    pub diagnostics: DiagnosticsSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRecord {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSnapshot {
    pub gemini_configured: bool,
    pub deepgram_configured: bool,
    pub linear_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub mode: &'static str,
    pub build_target: &'static str,
    pub keychain_available: bool,
    pub database_ready: bool,
    pub state_machine_ready: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSettingInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSecretInput {
    pub key: String,
    pub value: String,
}

fn secret_snapshot(presence: &SecretPresence) -> SecretSnapshot {
    SecretSnapshot {
        gemini_configured: presence.gemini_configured,
        deepgram_configured: presence.deepgram_configured,
        linear_configured: presence.linear_configured,
    }
}

#[tauri::command]
pub fn bootstrap_app(state: State<'_, AppState>) -> Result<BootstrapPayload, String> {
    let permissions = state.permissions().snapshot();
    let settings = state
        .database()
        .list_settings()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| SettingRecord { key, value })
        .collect::<Vec<_>>();

    let secrets = state
        .secret_store()
        .presence()
        .map_err(|error| error.to_string())?;

    Ok(BootstrapPayload {
        app_name: "Cluely Desktop".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        permissions,
        settings,
        secrets: secret_snapshot(&secrets),
        providers: state.providers().snapshot(&secrets),
        diagnostics: DiagnosticsSnapshot {
            mode: "desktop",
            build_target: "tauri",
            keychain_available: cfg!(target_os = "macos"),
            database_ready: true,
            state_machine_ready: SessionStateMachine::new().current().is_some(),
        },
    })
}

#[tauri::command]
pub fn save_setting(
    state: State<'_, AppState>,
    input: SaveSettingInput,
) -> Result<Vec<SettingRecord>, String> {
    let database = state.database();
    database
        .save_setting(&input.key, &input.value)
        .map_err(|error| error.to_string())?;

    database
        .list_settings()
        .map_err(|error| error.to_string())
        .map(|settings| {
            settings
                .into_iter()
                .map(|(key, value)| SettingRecord { key, value })
                .collect::<Vec<_>>()
        })
}

#[tauri::command]
pub fn save_secret(state: State<'_, AppState>, input: SaveSecretInput) -> Result<(), String> {
    state
        .secret_store()
        .save_secret(&input.key, &input.value)
        .map_err(|error| error.to_string())
}
