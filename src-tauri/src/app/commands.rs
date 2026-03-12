use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app::state::AppState;
use crate::db::{
    GeneratedTicketInputRow, GeneratedTicketRow, MessageRow, SessionDerivedUpdate, SessionRow,
    TranscriptRow,
};
use crate::permissions::PermissionSnapshot;
use crate::providers::ProviderSnapshot;
use crate::secrets::SecretPresence;
use crate::session::state_machine::SessionStateMachine;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecordPayload {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub updated_at: String,
    pub rolling_summary: Option<String>,
    pub final_summary: Option<String>,
    pub decisions_md: Option<String>,
    pub action_items_md: Option<String>,
    pub follow_up_email_md: Option<String>,
    pub notes_md: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentPayload {
    pub id: String,
    pub session_id: String,
    pub sequence_no: i64,
    pub speaker_label: Option<String>,
    pub text: String,
    pub is_final: bool,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePayload {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTicketPayload {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: String,
    pub idempotency_key: String,
    pub source_line: Option<String>,
    pub linear_issue_id: Option<String>,
    pub linear_issue_key: Option<String>,
    pub linear_issue_url: Option<String>,
    pub pushed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailPayload {
    pub session: SessionRecordPayload,
    pub transcripts: Vec<TranscriptSegmentPayload>,
    pub messages: Vec<ChatMessagePayload>,
    pub generated_tickets: Vec<GeneratedTicketPayload>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionInput {
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendTranscriptInput {
    pub session_id: String,
    pub speaker_label: Option<String>,
    pub text: String,
    pub is_final: Option<bool>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSessionInput {
    pub session_id: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTicketInput {
    pub idempotency_key: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: String,
    pub source_line: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneratedTicketsInput {
    pub session_id: String,
    pub tickets: Vec<GeneratedTicketInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkGeneratedTicketPushedInput {
    pub session_id: String,
    pub idempotency_key: String,
    pub linear_issue_id: String,
    pub linear_issue_key: String,
    pub linear_issue_url: String,
    pub pushed_at: Option<String>,
}

fn secret_snapshot(presence: &SecretPresence) -> SecretSnapshot {
    SecretSnapshot {
        gemini_configured: presence.gemini_configured,
        deepgram_configured: presence.deepgram_configured,
        linear_configured: presence.linear_configured,
    }
}

fn map_session(row: SessionRow) -> SessionRecordPayload {
    SessionRecordPayload {
        id: row.id,
        title: row.title,
        status: row.status,
        started_at: row.started_at,
        ended_at: row.ended_at,
        updated_at: row.updated_at,
        rolling_summary: row.rolling_summary,
        final_summary: row.final_summary,
        decisions_md: row.decisions_md,
        action_items_md: row.action_items_md,
        follow_up_email_md: row.follow_up_email_md,
        notes_md: row.notes_md,
    }
}

fn map_transcript(row: TranscriptRow) -> TranscriptSegmentPayload {
    TranscriptSegmentPayload {
        id: row.id,
        session_id: row.session_id,
        sequence_no: row.sequence_no,
        speaker_label: row.speaker_label,
        text: row.text,
        is_final: row.is_final,
        source: row.source,
        created_at: row.created_at,
    }
}

fn map_message(row: MessageRow) -> ChatMessagePayload {
    ChatMessagePayload {
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
    }
}

fn map_generated_ticket(row: GeneratedTicketRow) -> GeneratedTicketPayload {
    GeneratedTicketPayload {
        id: row.id,
        session_id: row.session_id,
        title: row.title,
        description: row.description,
        acceptance_criteria: serde_json::from_str(&row.acceptance_criteria).unwrap_or_default(),
        ticket_type: row.ticket_type,
        idempotency_key: row.idempotency_key,
        source_line: row.source_line,
        linear_issue_id: row.linear_issue_id,
        linear_issue_key: row.linear_issue_key,
        linear_issue_url: row.linear_issue_url,
        pushed_at: row.pushed_at,
        created_at: row.created_at,
    }
}

fn to_bullet_md(lines: &[String]) -> String {
    if lines.is_empty() {
        return "- No signal detected yet.".to_string();
    }

    lines
        .iter()
        .map(|line| format!("- {}", line.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn derive_session_update(transcripts: &[TranscriptRow]) -> SessionDerivedUpdate {
    let lines = transcripts
        .iter()
        .map(|segment| segment.text.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    let summary_lines = lines.iter().take(4).cloned().collect::<Vec<_>>();
    let decision_lines = lines
        .iter()
        .filter(|line| {
            let lowercase = line.to_lowercase();
            lowercase.contains("decid")
                || lowercase.contains("agree")
                || lowercase.contains("plan")
                || lowercase.contains("ship")
                || lowercase.contains("rollout")
                || lowercase.contains("confirm")
        })
        .take(4)
        .cloned()
        .collect::<Vec<_>>();
    let action_lines = lines
        .iter()
        .filter(|line| {
            let lowercase = line.to_lowercase();
            lowercase.contains("will")
                || lowercase.contains("owner")
                || lowercase.contains("todo")
                || lowercase.contains("follow-up")
                || lowercase.contains("task")
                || lowercase.contains("fix")
                || lowercase.contains("handle")
        })
        .take(5)
        .cloned()
        .collect::<Vec<_>>();

    let rolling_summary = if summary_lines.is_empty() {
        "No transcript signal captured yet.".to_string()
    } else {
        format!(
            "This session focused on {}",
            summary_lines.join(" ").replace('\n', " ")
        )
    };
    let final_summary = rolling_summary.clone();
    let decisions_md = to_bullet_md(&decision_lines);
    let action_items_md = to_bullet_md(&action_lines);
    let notes_md = to_bullet_md(&lines.iter().take(6).cloned().collect::<Vec<_>>());
    let follow_up_email_md = [
        "Team,",
        "",
        final_summary.as_str(),
        "",
        "Decisions",
        decisions_md.as_str(),
        "",
        "Next steps",
        action_items_md.as_str(),
    ]
    .join("\n");

    SessionDerivedUpdate {
        rolling_summary: Some(rolling_summary),
        final_summary: Some(final_summary),
        decisions_md: Some(decisions_md),
        action_items_md: Some(action_items_md),
        follow_up_email_md: Some(follow_up_email_md),
        notes_md: Some(notes_md),
    }
}

fn assistant_response_for_action(action: &str, derived: &SessionDerivedUpdate) -> String {
    match action {
        "summary" => derived
            .final_summary
            .clone()
            .unwrap_or_else(|| "No summary available yet.".to_string()),
        "decisions" => derived
            .decisions_md
            .clone()
            .unwrap_or_else(|| "- No decisions detected yet.".to_string()),
        "next_steps" => derived
            .action_items_md
            .clone()
            .unwrap_or_else(|| "- No action items detected yet.".to_string()),
        "follow_up" => derived
            .follow_up_email_md
            .clone()
            .unwrap_or_else(|| "No follow-up draft available yet.".to_string()),
        _ => derived
            .final_summary
            .clone()
            .unwrap_or_else(|| "No response available yet.".to_string()),
    }
}

fn assistant_response_for_prompt(prompt: &str, derived: &SessionDerivedUpdate) -> String {
    let lowercase = prompt.to_lowercase();

    if lowercase.contains("decid") {
        return assistant_response_for_action("decisions", derived);
    }
    if lowercase.contains("next") || lowercase.contains("action") {
        return assistant_response_for_action("next_steps", derived);
    }
    if lowercase.contains("follow") {
        return assistant_response_for_action("follow_up", derived);
    }

    assistant_response_for_action("summary", derived)
}

fn load_session_detail(state: &AppState, session_id: &str) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    let session = database
        .get_session(session_id)
        .map_err(|error| error.to_string())?;

    match session {
        Some(session_row) => {
            let transcripts = database
                .list_transcript_segments(session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(map_transcript)
                .collect::<Vec<_>>();
            let messages = database
                .list_messages(session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(map_message)
                .collect::<Vec<_>>();
            let generated_tickets = database
                .list_generated_tickets(session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(map_generated_ticket)
                .collect::<Vec<_>>();

            Ok(Some(SessionDetailPayload {
                session: map_session(session_row),
                transcripts,
                messages,
                generated_tickets,
            }))
        }
        None => Ok(None),
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

#[tauri::command]
pub fn read_secret_value(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state
        .secret_store()
        .read_secret(&key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionRecordPayload>, String> {
    state
        .database()
        .list_sessions()
        .map_err(|error| error.to_string())
        .map(|sessions| sessions.into_iter().map(map_session).collect())
}

#[tauri::command]
pub fn get_session_detail(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn start_session(
    state: State<'_, AppState>,
    input: StartSessionInput,
) -> Result<SessionDetailPayload, String> {
    let database = state.database();
    let session = database
        .create_session(input.title.trim())
        .map_err(|error| error.to_string())?;
    database
        .append_message(&session.id, "system", "Session started. Transcript capture is ready.")
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &session.id)?
        .ok_or_else(|| "session detail missing after creation".to_string())
}

#[tauri::command]
pub fn pause_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    state
        .database()
        .update_session_status(&session_id, "paused", None)
        .map_err(|error| error.to_string())?;
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn resume_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    state
        .database()
        .update_session_status(&session_id, "active", None)
        .map_err(|error| error.to_string())?;
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn complete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    let transcripts = database
        .list_transcript_segments(&session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    let ended_at = Utc::now().to_rfc3339();

    database
        .update_session_status(&session_id, "completed", Some(&ended_at))
        .map_err(|error| error.to_string())?;
    database
        .update_session_derived(&session_id, &derived)
        .map_err(|error| error.to_string())?;
    database
        .append_message(
            &session_id,
            "assistant",
            derived
                .final_summary
                .as_deref()
                .unwrap_or("No summary available yet."),
        )
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn append_transcript_segment(
    state: State<'_, AppState>,
    input: AppendTranscriptInput,
) -> Result<Option<SessionDetailPayload>, String> {
    state
        .database()
        .append_transcript_segment(
            &input.session_id,
            input.speaker_label.as_deref(),
            input.text.trim(),
            input.is_final.unwrap_or(true),
            input.source.as_deref().unwrap_or("manual"),
        )
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn run_dynamic_action(
    state: State<'_, AppState>,
    session_id: String,
    action: String,
) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    let transcripts = database
        .list_transcript_segments(&session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    let response = assistant_response_for_action(&action, &derived);

    database
        .update_session_derived(&session_id, &derived)
        .map_err(|error| error.to_string())?;
    database
        .append_message(&session_id, "assistant", &response)
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn ask_assistant(
    state: State<'_, AppState>,
    input: AskSessionInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    let transcripts = database
        .list_transcript_segments(&input.session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    let response = assistant_response_for_prompt(&input.prompt, &derived);

    database
        .append_message(&input.session_id, "user", &input.prompt)
        .map_err(|error| error.to_string())?;
    database
        .append_message(&input.session_id, "assistant", &response)
        .map_err(|error| error.to_string())?;
    database
        .update_session_derived(&input.session_id, &derived)
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn save_generated_tickets(
    state: State<'_, AppState>,
    input: SaveGeneratedTicketsInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let mut ticket_rows = Vec::with_capacity(input.tickets.len());
    for ticket in input.tickets {
        ticket_rows.push(GeneratedTicketInputRow {
            idempotency_key: ticket.idempotency_key,
            title: ticket.title,
            description: ticket.description,
            acceptance_criteria: serde_json::to_string(&ticket.acceptance_criteria)
                .map_err(|error| error.to_string())?,
            ticket_type: ticket.ticket_type,
            source_line: ticket.source_line,
        });
    }

    state
        .database()
        .replace_generated_tickets(&input.session_id, &ticket_rows)
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn mark_generated_ticket_pushed(
    state: State<'_, AppState>,
    input: MarkGeneratedTicketPushedInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let pushed_at = input.pushed_at.unwrap_or_else(|| Utc::now().to_rfc3339());
    state
        .database()
        .mark_generated_ticket_pushed(
            &input.session_id,
            &input.idempotency_key,
            &input.linear_issue_id,
            &input.linear_issue_key,
            &input.linear_issue_url,
            &pushed_at,
        )
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}
