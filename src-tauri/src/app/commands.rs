use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::Engine as _;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::app::state::AppState;
use crate::audio::{
    CaptureCapabilities, CaptureStatePayload, StartSystemAudioCaptureInput,
    SystemAudioSourceListPayload,
};
use crate::db::{
    GeneratedTicketInputRow, GeneratedTicketRow, MessageRow, SearchResultRow, SessionDerivedUpdate,
    SessionRow, SessionSpeakerRow, TranscriptRow,
};
use crate::exports::build_session_markdown;
use crate::knowledge::{
    delete_file, ingest_text_file, list_files, KnowledgeFileRecord, SaveKnowledgeFileInput,
};
use crate::permissions::PermissionSnapshot;
use crate::prompts::{list_prompts, save_prompt, PromptRecord, SavePromptInput};
use crate::providers::linear::{
    build_linear_dedupe_key, build_linear_dedupe_marker,
    check_connectivity as check_linear_connectivity, choose_canonical_issue, create_issue,
    find_issues_by_marker, LinearIssue, LinearIssueMatch, LinearIssueRequest,
};
use crate::providers::llm::{
    check_connectivity as check_llm_connectivity, generate_text_multimodal_with_options,
    generate_text_with_options,
    stream_text_multimodal_with_options, LlmGenerationOptions, LlmPart,
};
use crate::providers::stt::check_connectivity as check_stt_connectivity;
use crate::providers::ProviderSnapshot;
use crate::screenshot::ScreenshotStore;
use crate::secrets::SecretPresence;
use crate::session::manager::SessionRuntimeSnapshot;
use crate::session::state_machine::SessionStatus;
use crate::search::RetrievedContextChunk;
use crate::tickets::generate_tickets;
use crate::transcript::{
    format_transcript_document, select_relevant_transcript_snippets, truncate_context_middle,
};
use crate::window::WindowRuntimeSnapshot;

const MEETING_ASSISTANT_SYSTEM_PROMPT: &str = "You are TPMCluely, a real-time meeting copilot for engineering conversations. Use the transcript as the primary source of truth. If a shared screen image is provided, use it only when it materially helps answer the current question. Never invent facts. If transcript and screen context disagree, say so explicitly. Cite transcript snippets using labels like [S14]. If you used the shared screen, cite it as [Screen]. Keep spoken answers concise enough for the user to read aloud in a meeting.";
const ACTION_ASSISTANT_SYSTEM_PROMPT: &str = "You are TPMCluely, a real-time meeting copilot for engineering conversations. Use the transcript as the primary source of truth. If a shared screen image is provided, use it only when it materially helps answer the current question. Be specific, concise, and grounded. If evidence is weak or missing, say that clearly instead of guessing. Cite transcript snippets using labels like [S14]. If you used the shared screen, cite it as [Screen].";
const MAX_ASSISTANT_TRANSCRIPT_CHARS: usize = 18_000;
const ASK_MAX_OUTPUT_TOKENS: u32 = 160;
const ASSISTANT_STREAM_FLUSH_INTERVAL: Duration = Duration::from_millis(50);
pub const EVENT_ASSISTANT_STARTED: &str = "assistant:started";
pub const EVENT_ASSISTANT_CHUNK: &str = "assistant:chunk";
pub const EVENT_ASSISTANT_COMPLETED: &str = "assistant:completed";
pub const EVENT_ASSISTANT_FAILED: &str = "assistant:failed";

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
    pub capture_capabilities: CaptureCapabilities,
    pub runtime: RuntimeSnapshot,
    pub prompts: Vec<PromptRecord>,
    pub knowledge_files: Vec<KnowledgeFileRecord>,
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
    pub window_controller_ready: bool,
    pub search_ready: bool,
    pub semantic_search_ready: bool,
    pub prompt_library_ready: bool,
    pub knowledge_library_ready: bool,
    pub export_ready: bool,
    pub permission_detection_ready: bool,
    pub capture_backend: &'static str,
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub session: SessionRuntimeSnapshot,
    pub window: WindowRuntimeSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecordPayload {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub capture_mode: String,
    pub capture_target_kind: Option<String>,
    pub capture_target_label: Option<String>,
    pub updated_at: String,
    pub rolling_summary: Option<String>,
    pub final_summary: Option<String>,
    pub decisions_md: Option<String>,
    pub action_items_md: Option<String>,
    pub follow_up_email_md: Option<String>,
    pub notes_md: Option<String>,
    pub ticket_generation_state: String,
    pub ticket_generation_error: Option<String>,
    pub ticket_generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentPayload {
    pub id: String,
    pub session_id: String,
    pub sequence_no: i64,
    pub speaker_id: Option<String>,
    pub speaker_label: Option<String>,
    pub speaker_confidence: Option<f64>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub text: String,
    pub is_final: bool,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpeakerPayload {
    pub session_id: String,
    pub speaker_id: String,
    pub provider_label: Option<String>,
    pub display_label: String,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePayload {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub context_snapshot: Option<String>,
    pub attachments: Vec<MessageAttachmentPayload>,
    pub metadata: Option<MessageMetadataPayload>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MessageAttachmentPayload {
    pub kind: String,
    pub artifact_id: Option<String>,
    pub mime_type: String,
    pub captured_at: String,
    pub width: u32,
    pub height: u32,
    pub source_label: String,
    pub persisted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MessageMetadataPayload {
    pub response_mode: Option<String>,
    pub provider_name: Option<String>,
    pub provider_error: Option<String>,
    pub latency_ms: Option<u64>,
    pub streamed: bool,
    pub first_chunk_latency_ms: Option<u64>,
    pub screen_capture_wait_ms: Option<u64>,
    pub used_screen_context: bool,
    pub citations: Vec<String>,
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
    pub linear_push_state: String,
    pub linear_last_error: Option<String>,
    pub linear_last_attempt_at: Option<String>,
    pub linear_deduped: bool,
    pub review_state: String,
    pub approved_at: Option<String>,
    pub rejected_at: Option<String>,
    pub rejection_reason: Option<String>,
    pub reviewed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailPayload {
    pub session: SessionRecordPayload,
    pub speakers: Vec<SessionSpeakerPayload>,
    pub transcripts: Vec<TranscriptSegmentPayload>,
    pub messages: Vec<ChatMessagePayload>,
    pub generated_tickets: Vec<GeneratedTicketPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultPayload {
    pub session_id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
    pub snippet: String,
    pub matched_field: String,
    pub match_label: String,
    pub retrieval_mode: String,
    pub transcript_sequence_start: Option<i64>,
    pub transcript_sequence_end: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionPayload {
    pub session_id: String,
    pub file_name: String,
    pub markdown: String,
    pub artifact_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheckPayload {
    pub key: String,
    pub title: String,
    pub status: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightModePayload {
    pub mode: String,
    pub can_start: bool,
    pub state: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReportPayload {
    pub checked_at: String,
    pub checks: Vec<PreflightCheckPayload>,
    pub modes: Vec<PreflightModePayload>,
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
    pub initial_status: Option<String>,
    pub capture_mode: Option<String>,
    pub capture_target_kind: Option<String>,
    pub capture_target_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCaptureSessionUpdateInput {
    pub session_id: String,
    pub status: String,
    pub capture_mode: Option<String>,
    pub capture_target_kind: Option<String>,
    pub capture_target_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendTranscriptInput {
    pub session_id: String,
    pub speaker_id: Option<String>,
    pub speaker_label: Option<String>,
    pub speaker_confidence: Option<f64>,
    pub text: String,
    pub is_final: Option<bool>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionSpeakerInput {
    pub session_id: String,
    pub speaker_id: String,
    pub display_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSessionInput {
    pub session_id: String,
    pub prompt: String,
    pub screen_context: Option<ScreenContextInput>,
    pub screen_capture_wait_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSessionStreamInput {
    pub request_id: String,
    pub session_id: String,
    pub prompt: String,
    pub screen_context: Option<ScreenContextInput>,
    pub screen_capture_wait_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDynamicActionInput {
    pub session_id: String,
    pub action: String,
    pub screen_context: Option<ScreenContextInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskAssistantStreamStartPayload {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStartedPayload {
    pub request_id: String,
    pub session_id: String,
    pub prompt: String,
    pub started_at: String,
    pub requested_screen_context: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChunkPayload {
    pub request_id: String,
    pub session_id: String,
    pub delta: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantCompletedPayload {
    pub request_id: String,
    pub session_id: String,
    pub detail: Option<SessionDetailPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantFailedPayload {
    pub request_id: String,
    pub session_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextInput {
    pub mime_type: String,
    pub data_base64: String,
    pub captured_at: String,
    pub width: u32,
    pub height: u32,
    pub source_label: String,
    pub stale_ms: u64,
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
pub struct UpdateGeneratedTicketDraftInput {
    pub session_id: String,
    pub idempotency_key: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetGeneratedTicketReviewStateInput {
    pub session_id: String,
    pub idempotency_key: String,
    pub review_state: String,
    pub rejection_reason: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushGeneratedTicketInput {
    pub session_id: String,
    pub idempotency_key: String,
}

fn secret_snapshot(presence: &SecretPresence) -> SecretSnapshot {
    SecretSnapshot {
        gemini_configured: presence.gemini_configured,
        deepgram_configured: presence.deepgram_configured,
        linear_configured: presence.linear_configured,
    }
}

pub(crate) fn map_session(row: SessionRow) -> SessionRecordPayload {
    SessionRecordPayload {
        id: row.id,
        title: row.title,
        status: row.status,
        started_at: row.started_at,
        ended_at: row.ended_at,
        capture_mode: row.capture_mode,
        capture_target_kind: row.capture_target_kind,
        capture_target_label: row.capture_target_label,
        updated_at: row.updated_at,
        rolling_summary: row.rolling_summary,
        final_summary: row.final_summary,
        decisions_md: row.decisions_md,
        action_items_md: row.action_items_md,
        follow_up_email_md: row.follow_up_email_md,
        notes_md: row.notes_md,
        ticket_generation_state: row.ticket_generation_state,
        ticket_generation_error: row.ticket_generation_error,
        ticket_generated_at: row.ticket_generated_at,
    }
}

fn parse_session_status(value: &str) -> Result<SessionStatus, String> {
    match value {
        "preparing" => Ok(SessionStatus::Preparing),
        "active" => Ok(SessionStatus::Active),
        "paused" => Ok(SessionStatus::Paused),
        "permission_blocked" => Ok(SessionStatus::PermissionBlocked),
        "capture_error" => Ok(SessionStatus::CaptureError),
        "provider_degraded" => Ok(SessionStatus::ProviderDegraded),
        other => Err(format!("Unsupported session status: {other}")),
    }
}

pub(crate) fn map_transcript(row: TranscriptRow) -> TranscriptSegmentPayload {
    TranscriptSegmentPayload {
        id: row.id,
        session_id: row.session_id,
        sequence_no: row.sequence_no,
        speaker_id: row.speaker_id,
        speaker_label: row.speaker_label,
        speaker_confidence: row.speaker_confidence,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        text: row.text,
        is_final: row.is_final,
        source: row.source,
        created_at: row.created_at,
    }
}

fn map_session_speaker(row: SessionSpeakerRow) -> SessionSpeakerPayload {
    SessionSpeakerPayload {
        session_id: row.session_id,
        speaker_id: row.speaker_id,
        provider_label: row.provider_label,
        display_label: row.display_label,
        source: row.source,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn parse_message_metadata(raw: Option<&str>) -> Option<MessageMetadataPayload> {
    raw.and_then(|value| serde_json::from_str::<MessageMetadataPayload>(value).ok())
}

fn map_message(row: MessageRow) -> ChatMessagePayload {
    ChatMessagePayload {
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        context_snapshot: row.context_snapshot,
        attachments: row
            .attachments_json
            .as_deref()
            .and_then(|attachments| serde_json::from_str(attachments).ok())
            .unwrap_or_default(),
        metadata: parse_message_metadata(row.metadata_json.as_deref()),
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
        linear_push_state: row.linear_push_state,
        linear_last_error: row.linear_last_error,
        linear_last_attempt_at: row.linear_last_attempt_at,
        linear_deduped: row.linear_deduped,
        review_state: row.review_state,
        approved_at: row.approved_at,
        rejected_at: row.rejected_at,
        rejection_reason: row.rejection_reason,
        reviewed_at: row.reviewed_at,
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

fn transcript_line_with_speaker(segment: &TranscriptRow) -> String {
    let label = segment
        .speaker_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unattributed");
    format!("{label}: {}", segment.text.trim())
}

pub(crate) fn derive_session_update(transcripts: &[TranscriptRow]) -> SessionDerivedUpdate {
    let lines = transcripts
        .iter()
        .map(|segment| segment.text.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let attributed_lines = transcripts
        .iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .map(transcript_line_with_speaker)
        .collect::<Vec<_>>();

    let summary_lines = lines.iter().take(4).cloned().collect::<Vec<_>>();
    let decision_lines = transcripts
        .iter()
        .filter(|segment| {
            let lowercase = segment.text.to_lowercase();
            lowercase.contains("decid")
                || lowercase.contains("agree")
                || lowercase.contains("plan")
                || lowercase.contains("ship")
                || lowercase.contains("rollout")
                || lowercase.contains("confirm")
        })
        .take(4)
        .map(transcript_line_with_speaker)
        .collect::<Vec<_>>();
    let action_lines = transcripts
        .iter()
        .filter(|segment| {
            let lowercase = segment.text.to_lowercase();
            lowercase.contains("will")
                || lowercase.contains("owner")
                || lowercase.contains("todo")
                || lowercase.contains("follow-up")
                || lowercase.contains("task")
                || lowercase.contains("fix")
                || lowercase.contains("handle")
        })
        .take(5)
        .map(transcript_line_with_speaker)
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
    let notes_md = to_bullet_md(&attributed_lines.iter().take(6).cloned().collect::<Vec<_>>());
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

fn ask_generation_options() -> LlmGenerationOptions {
    LlmGenerationOptions {
        response_mime_type: None,
        max_output_tokens: Some(ASK_MAX_OUTPUT_TOKENS),
    }
}

fn load_settings_map(state: &AppState) -> Result<HashMap<String, String>, String> {
    state
        .database()
        .list_settings()
        .map_err(|error| error.to_string())
        .map(|settings| settings.into_iter().collect::<HashMap<_, _>>())
}

fn setting_enabled(settings: &HashMap<String, String>, key: &str, default: bool) -> bool {
    settings
        .get(key)
        .map(|value| value == "true")
        .unwrap_or(default)
}

fn format_recent_messages(messages: &[MessageRow], current_prompt: &str) -> String {
    let mut recent = messages
        .iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .collect::<Vec<_>>();

    while matches!(
        recent.last(),
        Some(message)
            if message.role == "user"
                && message.content.trim().eq_ignore_ascii_case(current_prompt.trim())
    ) {
        recent.pop();
    }

    let recent = recent.into_iter().rev().take(2).collect::<Vec<_>>();

    if recent.is_empty() {
        return "No prior Ask TPMCluely conversation yet.".to_string();
    }

    recent
        .into_iter()
        .rev()
        .map(|message| format!("{}: {}", message.role.to_uppercase(), message.content.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_screen_context_note(screen_context: Option<&ScreenContextInput>) -> String {
    match screen_context {
        Some(context) => format!(
            "A shared screen frame is attached from \"{}\" captured at {}. It is {}x{} and {}ms stale. Use it only if it materially helps answer the current question. If it is irrelevant, ignore it.",
            context.source_label,
            context.captured_at,
            context.width,
            context.height,
            context.stale_ms
        ),
        None => "No shared screen frame is attached for this request.".to_string(),
    }
}

fn format_context_chunk(chunk: RetrievedContextChunk) -> String {
    if chunk.sequence_start == chunk.sequence_end {
        format!("[S{}] {}", chunk.sequence_start, chunk.text.trim())
    } else {
        format!(
            "[S{}-S{}] {}",
            chunk.sequence_start,
            chunk.sequence_end,
            chunk.text.trim()
        )
    }
}

async fn load_question_snippets(
    state: &AppState,
    session_id: &str,
    prompt: &str,
    transcripts: &[TranscriptRow],
) -> Vec<String> {
    match state
        .search_runtime()
        .retrieve_session_context(session_id, prompt, 6)
        .await
    {
        Ok(Some(chunks)) if !chunks.is_empty() => {
            chunks.into_iter().map(format_context_chunk).collect()
        }
        _ => select_relevant_transcript_snippets(transcripts, prompt),
    }
}

fn build_question_prompt(
    prompt: &str,
    snippet_lines: &[String],
    messages: &[MessageRow],
    derived: &SessionDerivedUpdate,
    screen_context: Option<&ScreenContextInput>,
    prompt_snapshot: Option<&str>,
    output_language: &str,
) -> String {
    let snippets = snippet_lines.join("\n");
    let recent_messages = format_recent_messages(messages, prompt);
    format!(
        "Rolling summary:\n{}\n\nPrompt snapshot:\n{}\n\nOutput language:\n{}\n\nRecent Ask TPMCluely conversation:\n{}\n\nRelevant transcript snippets:\n{}\n\nShared screen context:\n{}\n\nQuestion to answer aloud:\n{}\n\nAnswer in 2-4 spoken sentences. Answer primarily from the transcript. Use the shared screen only if it materially improves the answer. If the transcript does not contain the answer, say that clearly. If transcript and screen disagree, call that out. Cite only the transcript snippets you actually relied on using their [S#] or [S#-S#] labels. Cite [Screen] only if the image materially informed the answer.",
        derived
            .rolling_summary
            .as_deref()
            .unwrap_or("No rolling summary available yet."),
        prompt_snapshot.unwrap_or("No custom prompt is active for this session."),
        output_language,
        recent_messages,
        snippets,
        format_screen_context_note(screen_context),
        prompt
    )
}

fn build_action_prompt(
    action: &str,
    transcripts: &[TranscriptRow],
    derived: &SessionDerivedUpdate,
    screen_context: Option<&ScreenContextInput>,
    prompt_snapshot: Option<&str>,
    output_language: &str,
) -> String {
    let transcript_text = truncate_context_middle(
        &format_transcript_document(transcripts),
        MAX_ASSISTANT_TRANSCRIPT_CHARS,
    );
    let directive = match action {
        "summary" => {
            "Write a concise spoken summary of the meeting so far in 3-5 sentences."
        }
        "decisions" => {
            "Extract only the decisions that were actually made. Return short markdown bullet points."
        }
        "next_steps" => {
            "Extract the follow-up actions and next steps. Return markdown bullet points with owners when the transcript makes them clear."
        }
        "follow_up" => {
            "Draft 3-5 grounded follow-up questions the user should ask next. Return markdown bullet points. Each follow-up should meaningfully deepen implementation clarity, risk, dependencies, rollout, or ownership based on what is still unresolved in the transcript."
        }
        _ => "Summarize the meeting so far.",
    };

    format!(
        "Rolling summary:\n{}\n\nPrompt snapshot:\n{}\n\nOutput language:\n{}\n\nMeeting transcript:\n{}\n\nShared screen context:\n{}\n\nTask:\n{}",
        derived
            .rolling_summary
            .as_deref()
            .unwrap_or("No rolling summary available yet."),
        prompt_snapshot.unwrap_or("No custom prompt is active for this session."),
        output_language,
        transcript_text,
        format_screen_context_note(screen_context),
        directive
    )
}

fn multimodal_user_parts(
    prompt: String,
    screen_context: Option<&ScreenContextInput>,
) -> Vec<LlmPart> {
    let mut parts = vec![LlmPart::Text(prompt)];
    if let Some(screen_context) = screen_context {
        parts.push(LlmPart::InlineImage {
            mime_type: screen_context.mime_type.clone(),
            data_base64: screen_context.data_base64.clone(),
        });
    }
    parts
}

fn screen_context_snapshot(screen_context: &ScreenContextInput) -> String {
    format!(
        "Shared screen context from \"{}\" captured at {} ({}x{}, {}ms stale).",
        screen_context.source_label,
        screen_context.captured_at,
        screen_context.width,
        screen_context.height,
        screen_context.stale_ms
    )
}

fn insufficient_transcript_message() -> String {
    "I do not have enough transcript yet to answer that. Let the meeting run a little longer or add a manual transcript line first.".to_string()
}

fn extract_citations(content: &str) -> Vec<String> {
    static CITATION_REGEX: OnceLock<Regex> = OnceLock::new();
    let regex = CITATION_REGEX.get_or_init(|| {
        Regex::new(r"\[(Screen|S\d+(?:-S?\d+)?)\]").expect("citation regex should compile")
    });

    let mut citations = Vec::new();
    let mut seen = HashSet::new();
    for matched in regex.find_iter(content) {
        let citation = matched.as_str().to_string();
        if seen.insert(citation.clone()) {
            citations.push(citation);
        }
    }

    citations.sort_by_key(|citation| citation_sort_key(citation));
    citations
}

fn citation_sort_key(citation: &str) -> (u8, i64, i64) {
    if citation == "[Screen]" {
        return (0, 0, 0);
    }

    let normalized = citation.trim_matches(['[', ']']);
    let range = normalized.strip_prefix('S').unwrap_or(normalized);
    let mut parts = range.split('-');
    let start = parts
        .next()
        .and_then(|value| value.trim_start_matches('S').parse::<i64>().ok())
        .unwrap_or_default();
    let end = parts
        .next()
        .and_then(|value| value.trim_start_matches('S').parse::<i64>().ok())
        .unwrap_or(start);

    (1, start, end)
}

fn build_message_metadata(
    response_mode: &str,
    provider_name: Option<&str>,
    provider_error: Option<String>,
    latency_ms: Option<u64>,
    streamed: bool,
    first_chunk_latency_ms: Option<u64>,
    screen_capture_wait_ms: Option<u64>,
    used_screen_context: bool,
    content: &str,
) -> MessageMetadataPayload {
    MessageMetadataPayload {
        response_mode: Some(response_mode.to_string()),
        provider_name: provider_name.map(str::to_string),
        provider_error,
        latency_ms,
        streamed,
        first_chunk_latency_ms,
        screen_capture_wait_ms,
        used_screen_context,
        citations: extract_citations(content),
    }
}

fn metadata_json(metadata: &MessageMetadataPayload) -> Result<String, String> {
    serde_json::to_string(metadata).map_err(|error| error.to_string())
}

async fn generate_grounded_response(
    gemini_api_key: Option<String>,
    system_prompt: &str,
    prompt: String,
    screen_context: Option<&ScreenContextInput>,
    fallback_response: String,
    options: &LlmGenerationOptions,
) -> (String, MessageMetadataPayload) {
    let started_at = Instant::now();
    let requested_screen_context = screen_context.is_some();

    let Some(gemini_api_key) = gemini_api_key else {
        let metadata = build_message_metadata(
            "transcript_fallback",
            Some("Gemini"),
            Some("Gemini API key is not configured.".to_string()),
            Some(0),
            false,
            None,
            None,
            false,
            &fallback_response,
        );
        return (fallback_response, metadata);
    };

    let generation_result = match screen_context {
        Some(context) => {
            generate_text_multimodal_with_options(
                &gemini_api_key,
                system_prompt,
                &multimodal_user_parts(prompt, Some(context)),
                options,
            )
            .await
        }
        None => generate_text_with_options(&gemini_api_key, system_prompt, &prompt, options).await,
    };
    let latency_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    match generation_result {
        Ok(reply) if !reply.trim().is_empty() => {
            let response = reply.trim().to_string();
            let metadata = build_message_metadata(
                "gemini",
                Some("Gemini"),
                None,
                Some(latency_ms),
                false,
                None,
                None,
                requested_screen_context && response.contains("[Screen]"),
                &response,
            );
            (response, metadata)
        }
        Ok(_) => {
            let metadata = build_message_metadata(
                "transcript_fallback",
                Some("Gemini"),
                Some("Gemini returned an empty response.".to_string()),
                Some(latency_ms),
                false,
                None,
                None,
                false,
                &fallback_response,
            );
            (fallback_response, metadata)
        }
        Err(error) => {
            let metadata = build_message_metadata(
                "transcript_fallback",
                Some("Gemini"),
                Some(error.to_string()),
                Some(latency_ms),
                false,
                None,
                None,
                false,
                &fallback_response,
            );
            (fallback_response, metadata)
        }
    }
}

async fn generate_streamed_ask_response(
    app: &AppHandle,
    request_id: &str,
    session_id: &str,
    gemini_api_key: Option<String>,
    prompt: String,
    screen_context: Option<&ScreenContextInput>,
    fallback_response: String,
    screen_capture_wait_ms: Option<u64>,
) -> (String, MessageMetadataPayload) {
    let started_at = Instant::now();
    let requested_screen_context = screen_context.is_some();

    let Some(gemini_api_key) = gemini_api_key else {
        let metadata = build_message_metadata(
            "transcript_fallback",
            Some("Gemini"),
            Some("Gemini API key is not configured.".to_string()),
            Some(0),
            false,
            None,
            screen_capture_wait_ms,
            false,
            &fallback_response,
        );
        return (fallback_response, metadata);
    };

    let mut pending_delta = String::new();
    let mut streamed_content = String::new();
    let mut first_chunk_latency_ms = None;
    let mut last_emit_at = started_at;

    let generation_result = stream_text_multimodal_with_options(
        &gemini_api_key,
        MEETING_ASSISTANT_SYSTEM_PROMPT,
        &multimodal_user_parts(prompt, screen_context),
        &ask_generation_options(),
        |delta| {
            if delta.is_empty() {
                return;
            }
            if first_chunk_latency_ms.is_none() {
                first_chunk_latency_ms = Some(
                    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                );
            }
            streamed_content.push_str(delta);
            pending_delta.push_str(delta);
            let has_boundary = pending_delta.contains('\n')
                || pending_delta.ends_with('.')
                || pending_delta.ends_with('!')
                || pending_delta.ends_with('?');
            if has_boundary || last_emit_at.elapsed() >= ASSISTANT_STREAM_FLUSH_INTERVAL {
                let _ = app.emit(
                    EVENT_ASSISTANT_CHUNK,
                    &AssistantChunkPayload {
                        request_id: request_id.to_string(),
                        session_id: session_id.to_string(),
                        delta: pending_delta.clone(),
                        content: streamed_content.clone(),
                    },
                );
                pending_delta.clear();
                last_emit_at = Instant::now();
            }
        },
    )
    .await;

    if !pending_delta.is_empty() {
        let _ = app.emit(
            EVENT_ASSISTANT_CHUNK,
            &AssistantChunkPayload {
                request_id: request_id.to_string(),
                session_id: session_id.to_string(),
                delta: pending_delta.clone(),
                content: streamed_content.clone(),
            },
        );
    }

    let latency_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    match generation_result {
        Ok(reply) if !reply.trim().is_empty() => {
            let response = reply.trim().to_string();
            let metadata = build_message_metadata(
                "gemini",
                Some("Gemini"),
                None,
                Some(latency_ms),
                true,
                first_chunk_latency_ms,
                screen_capture_wait_ms,
                requested_screen_context && response.contains("[Screen]"),
                &response,
            );
            (response, metadata)
        }
        Ok(_) => {
            let metadata = build_message_metadata(
                "transcript_fallback",
                Some("Gemini"),
                Some("Gemini returned an empty response.".to_string()),
                Some(latency_ms),
                first_chunk_latency_ms.is_some(),
                first_chunk_latency_ms,
                screen_capture_wait_ms,
                false,
                &fallback_response,
            );
            (fallback_response, metadata)
        }
        Err(error) => {
            let provider_error = if first_chunk_latency_ms.is_some() {
                Some("Gemini stream interrupted.".to_string())
            } else {
                Some(error.to_string())
            };
            let metadata = build_message_metadata(
                "transcript_fallback",
                Some("Gemini"),
                provider_error,
                Some(latency_ms),
                first_chunk_latency_ms.is_some(),
                first_chunk_latency_ms,
                screen_capture_wait_ms,
                false,
                &fallback_response,
            );
            (fallback_response, metadata)
        }
    }
}

fn build_preflight_check(
    key: &str,
    title: &str,
    status: &str,
    message: impl Into<String>,
    detail: Option<String>,
) -> PreflightCheckPayload {
    PreflightCheckPayload {
        key: key.to_string(),
        title: title.to_string(),
        status: status.to_string(),
        message: message.into(),
        detail,
    }
}

#[derive(Debug, Clone)]
struct PreflightInputs {
    checked_at: String,
    permissions: PermissionSnapshot,
    capture_capabilities: CaptureCapabilities,
    database_ready: bool,
    keychain_ready: bool,
    gemini_ready: bool,
    gemini_connectivity: bool,
    deepgram_ready: bool,
    deepgram_connectivity: bool,
    linear_ready: bool,
    linear_connectivity: bool,
    preferred_microphone_device_id: String,
    screen_context_enabled: bool,
}

fn build_preflight_report(input: PreflightInputs) -> PreflightReportPayload {
    let microphone_permission_allows =
        !matches!(input.permissions.microphone, "denied" | "restricted");
    let screen_permission_granted = input.permissions.screen_recording == "granted";

    let mut checks = Vec::new();
    checks.push(build_preflight_check(
        "desktop_runtime",
        "Desktop runtime",
        "ready",
        "Native TPMCluely desktop runtime detected.",
        None,
    ));
    checks.push(build_preflight_check(
        "database_ready",
        "Session database",
        if input.database_ready {
            "ready"
        } else {
            "blocked"
        },
        if input.database_ready {
            "Local session database is ready."
        } else {
            "Local session database is unavailable."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "keychain_ready",
        "Keychain",
        if input.keychain_ready {
            "ready"
        } else {
            "warning"
        },
        if input.keychain_ready {
            "Secure secret storage is available."
        } else {
            "Keychain could not be verified. Secret-backed features may fail."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "gemini_key",
        "Gemini key",
        if input.gemini_ready {
            "ready"
        } else {
            "warning"
        },
        if input.gemini_ready {
            "Gemini API key is configured."
        } else {
            "Gemini API key is missing. Ask TPMCluely will use transcript fallback answers."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "gemini_connectivity",
        "Gemini connectivity",
        if input.gemini_ready && input.gemini_connectivity {
            "ready"
        } else {
            "warning"
        },
        if input.gemini_ready && input.gemini_connectivity {
            "Gemini connectivity check succeeded."
        } else if input.gemini_ready {
            "Gemini connectivity check failed. Transcript fallback answers will be used."
        } else {
            "Gemini connectivity was skipped because no key is configured."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "deepgram_key",
        "Deepgram key",
        if input.deepgram_ready { "ready" } else { "blocked" },
        if input.deepgram_ready {
            "Deepgram API key is configured."
        } else {
            "Deepgram API key is missing. Live transcription cannot start in microphone or system-audio mode."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "deepgram_connectivity",
        "Deepgram connectivity",
        if input.deepgram_ready && input.deepgram_connectivity {
            "ready"
        } else {
            "blocked"
        },
        if input.deepgram_ready && input.deepgram_connectivity {
            "Deepgram connectivity check succeeded."
        } else if input.deepgram_ready {
            "Deepgram connectivity check failed. Live transcription cannot start until this is fixed."
        } else {
            "Deepgram connectivity was skipped because no key is configured."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "linear_auth",
        "Linear auth",
        if input.linear_ready { "ready" } else { "warning" },
        if input.linear_ready {
            "Linear API key and team ID are configured."
        } else {
            "Linear API key or team ID is missing. Ticket push will remain local-only until configured."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "linear_team_lookup",
        "Linear team lookup",
        if input.linear_ready && input.linear_connectivity {
            "ready"
        } else {
            "warning"
        },
        if input.linear_ready && input.linear_connectivity {
            "Linear team lookup succeeded."
        } else if input.linear_ready {
            "Linear team lookup failed. Review-generated tickets will stay local until connectivity is restored."
        } else {
            "Linear lookup was skipped because credentials are incomplete."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "microphone_permission",
        "Microphone permission",
        match input.permissions.microphone {
            "granted" => "ready",
            "denied" | "restricted" => "blocked",
            _ => "warning",
        },
        match input.permissions.microphone {
            "granted" => "Microphone access is granted.",
            "denied" => "Microphone access is denied.",
            "restricted" => "Microphone access is restricted by macOS.",
            _ => "Microphone access will be requested on first use.",
        },
        None,
    ));
    checks.push(build_preflight_check(
        "screen_recording_permission",
        "Screen Recording permission",
        match input.permissions.screen_recording {
            "granted" => "ready",
            "denied" | "restricted" => "blocked",
            _ => "warning",
        },
        match input.permissions.screen_recording {
            "granted" => "Screen Recording access is granted.",
            "denied" => "Screen Recording access is denied.",
            "restricted" => "Screen Recording access is restricted by macOS.",
            _ => "Screen Recording access has not been granted yet.",
        },
        None,
    ));
    checks.push(build_preflight_check(
        "preferred_microphone",
        "Preferred microphone",
        if input.preferred_microphone_device_id.trim().is_empty() {
            "warning"
        } else {
            "ready"
        },
        if input.preferred_microphone_device_id.trim().is_empty() {
            "No preferred microphone is saved yet. Select one in the live session before the meeting starts."
        } else {
            "A preferred microphone is saved and will be verified in the live session UI."
        },
        if input.preferred_microphone_device_id.trim().is_empty() {
            None
        } else {
            Some(input.preferred_microphone_device_id.clone())
        },
    ));
    checks.push(build_preflight_check(
        "system_audio_capability",
        "System audio capture",
        if input.capture_capabilities.native_system_audio {
            if screen_permission_granted {
                "ready"
            } else {
                "blocked"
            }
        } else {
            "blocked"
        },
        if input.capture_capabilities.native_system_audio && screen_permission_granted {
            "Native system-audio capture is available."
        } else if input.capture_capabilities.native_system_audio {
            "System-audio capture is available once Screen Recording is granted."
        } else {
            "System-audio capture is only available in the macOS Tauri desktop runtime."
        },
        None,
    ));
    checks.push(build_preflight_check(
        "screen_context",
        "Screen context",
        if !input.screen_context_enabled {
            "warning"
        } else if screen_permission_granted {
            "ready"
        } else {
            "blocked"
        },
        if !input.screen_context_enabled {
            "Screen context is disabled in settings. Ask TPMCluely will remain transcript-only."
        } else if screen_permission_granted {
            "Screen context can be captured when you choose to share a screen."
        } else {
            "Screen context is enabled but Screen Recording permission is not ready."
        },
        None,
    ));

    let microphone_ready = input.database_ready
        && input.deepgram_ready
        && input.deepgram_connectivity
        && microphone_permission_allows;
    let system_audio_ready = input.database_ready
        && input.deepgram_ready
        && input.deepgram_connectivity
        && input.capture_capabilities.native_system_audio
        && screen_permission_granted;

    PreflightReportPayload {
        checked_at: input.checked_at,
        checks,
        modes: vec![
            PreflightModePayload {
                mode: "manual".to_string(),
                can_start: input.database_ready,
                state: if input.database_ready {
                    "ready".to_string()
                } else {
                    "blocked".to_string()
                },
                summary: if input.database_ready {
                    "Manual mode is ready. You can start the meeting even if providers are still being configured.".to_string()
                } else {
                    "Manual mode is blocked until the local database is ready.".to_string()
                },
            },
            PreflightModePayload {
                mode: "microphone".to_string(),
                can_start: microphone_ready,
                state: if microphone_ready {
                    "verification_required".to_string()
                } else {
                    "blocked".to_string()
                },
                summary: if microphone_ready {
                    "Microphone capture can start once TPMCluely verifies the selected input on this machine.".to_string()
                } else {
                    "Microphone capture is blocked until Deepgram is configured and microphone permission is available.".to_string()
                },
            },
            PreflightModePayload {
                mode: "system_audio".to_string(),
                can_start: system_audio_ready,
                state: if system_audio_ready {
                    "verification_required".to_string()
                } else {
                    "blocked".to_string()
                },
                summary: if system_audio_ready {
                    "System-audio capture can start once TPMCluely verifies a shareable source on this machine.".to_string()
                } else {
                    "System-audio capture is blocked until Deepgram, native capture, and Screen Recording are ready.".to_string()
                },
            },
        ],
    }
}

fn build_screen_attachment(
    screen_context: &ScreenContextInput,
    artifact_id: Option<String>,
    persisted: bool,
) -> MessageAttachmentPayload {
    MessageAttachmentPayload {
        kind: "screenshot".to_string(),
        artifact_id,
        mime_type: screen_context.mime_type.clone(),
        captured_at: screen_context.captured_at.clone(),
        width: screen_context.width,
        height: screen_context.height,
        source_label: screen_context.source_label.clone(),
        persisted,
    }
}

fn maybe_store_screen_artifact(
    state: &AppState,
    session_id: &str,
    message_id: &str,
    screen_context: Option<&ScreenContextInput>,
) -> Result<Vec<MessageAttachmentPayload>, String> {
    let Some(screen_context) = screen_context else {
        return Ok(Vec::new());
    };

    let settings = load_settings_map(state)?;
    if !setting_enabled(&settings, "persist_screen_artifacts", false) {
        return Ok(vec![build_screen_attachment(screen_context, None, false)]);
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(screen_context.data_base64.as_bytes())
        .map_err(|error| error.to_string())?;

    let extension = if screen_context.mime_type.eq_ignore_ascii_case("image/png") {
        "png"
    } else {
        "jpg"
    };
    let storage_path = ScreenshotStore::new().persist_bytes(
        &state.app_dir(),
        session_id,
        message_id,
        extension,
        &bytes,
    )?;

    let sha256 = {
        let mut digest = Sha256::new();
        digest.update(&bytes);
        hex::encode(digest.finalize())
    };

    let metadata_json = serde_json::to_string(&serde_json::json!({
        "capturedAt": screen_context.captured_at,
        "width": screen_context.width,
        "height": screen_context.height,
        "sourceLabel": screen_context.source_label,
        "messageId": message_id
    }))
    .map_err(|error| error.to_string())?;
    let storage_path_string = storage_path.to_string_lossy().to_string();

    let artifact_id = state
        .database()
        .insert_session_artifact(
            session_id,
            "screenshot",
            Some(storage_path_string.as_str()),
            Some(&screen_context.mime_type),
            Some(&sha256),
            Some(&metadata_json),
        )
        .map_err(|error| error.to_string())?;

    Ok(vec![build_screen_attachment(
        screen_context,
        Some(artifact_id),
        true,
    )])
}

fn append_assistant_message_with_metadata(
    state: &AppState,
    session_id: &str,
    content: &str,
    context_snapshot: Option<&str>,
    screen_context: Option<&ScreenContextInput>,
    metadata: &MessageMetadataPayload,
) -> Result<(), String> {
    let assistant_message_id = Uuid::new_v4().to_string();
    let assistant_attachments =
        maybe_store_screen_artifact(state, session_id, &assistant_message_id, screen_context)?;
    let assistant_attachments_json = if assistant_attachments.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&assistant_attachments).map_err(|error| error.to_string())?)
    };
    let assistant_metadata_json = metadata_json(metadata)?;
    state
        .database()
        .append_message_with_metadata(
            session_id,
            "assistant",
            content,
            context_snapshot,
            assistant_attachments_json.as_deref(),
            Some(&assistant_metadata_json),
            Some(&assistant_message_id),
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

struct LinearConfig {
    api_key: String,
    team_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TicketPushStatus {
    AlreadyPushed,
    Created,
    LinkedExisting,
    Failed,
}

#[derive(Debug, Clone)]
struct TicketPushOutcome {
    status: TicketPushStatus,
    warning: Option<String>,
}

#[derive(Debug, Default, Clone, Copy)]
struct TicketPushSummary {
    created: usize,
    linked: usize,
    failed: usize,
}

fn load_linear_config(state: &AppState) -> Result<Option<LinearConfig>, String> {
    let api_key = state
        .secret_store()
        .read_secret("linear_api_key")
        .map_err(|error| error.to_string())?
        .filter(|value| !value.trim().is_empty());
    let team_id = state
        .secret_store()
        .read_secret("linear_team_id")
        .map_err(|error| error.to_string())?
        .filter(|value| !value.trim().is_empty());

    match (api_key, team_id) {
        (Some(api_key), Some(team_id)) => Ok(Some(LinearConfig { api_key, team_id })),
        _ => Ok(None),
    }
}

fn append_system_message(state: &AppState, session_id: &str, content: &str) -> Result<(), String> {
    state
        .database()
        .append_message(session_id, "system", content)
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn generate_session_tickets_inner(
    state: &AppState,
    session_id: &str,
) -> Result<usize, String> {
    let database = state.database();
    let session = database
        .get_session(session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "session not found".to_string())?;

    if session.status != "completed" {
        return Err("Tickets can only be generated after the session is completed.".to_string());
    }

    let existing = database
        .list_generated_tickets(session_id)
        .map_err(|error| error.to_string())?;
    if existing.iter().any(|ticket| {
        ticket.linear_push_state == "pushed"
            || ticket.review_state != "draft"
            || ticket.reviewed_at.is_some()
    }) {
        let message =
            "Ticket regeneration is only allowed while all generated tickets remain unpushed drafts.";
        database
            .update_session_ticket_generation(session_id, "failed", Some(message), None)
            .map_err(|error| error.to_string())?;
        append_system_message(state, session_id, message)?;
        return Err(message.to_string());
    }

    let gemini_api_key = match load_gemini_api_key(state)? {
        Some(key) => key,
        None => {
            let message =
                "Gemini API key is required before TPMCluely can generate tickets.".to_string();
            database
                .update_session_ticket_generation(session_id, "failed", Some(&message), None)
                .map_err(|error| error.to_string())?;
            append_system_message(state, session_id, &message)?;
            return Err(message);
        }
    };

    let transcripts = database
        .list_transcript_segments(session_id)
        .map_err(|error| error.to_string())?;
    let transcript_text = format_transcript_document(&transcripts);

    let generated = match generate_tickets(&transcript_text, &gemini_api_key).await {
        Ok(generated) => generated,
        Err(error) => {
            let message = error.to_string();
            database
                .update_session_ticket_generation(session_id, "failed", Some(&message), None)
                .map_err(|db_error| db_error.to_string())?;
            append_system_message(
                state,
                session_id,
                &format!("Ticket generation could not finish automatically: {message}"),
            )?;
            return Err(message);
        }
    };

    if generated.raw_ticket_count > 0 && generated.tickets.is_empty() {
        let message =
            "Ticket generation returned output, but none of the tickets were valid enough to keep."
                .to_string();
        database
            .update_session_ticket_generation(session_id, "failed", Some(&message), None)
            .map_err(|error| error.to_string())?;
        append_system_message(state, session_id, &message)?;
        return Err(message);
    }

    let mut ticket_rows = Vec::with_capacity(generated.tickets.len());
    for ticket in &generated.tickets {
        ticket_rows.push(GeneratedTicketInputRow {
            idempotency_key: ticket.idempotency_key.clone(),
            title: ticket.title.clone(),
            description: ticket.description.clone(),
            acceptance_criteria: serde_json::to_string(&ticket.acceptance_criteria)
                .map_err(|error| error.to_string())?,
            ticket_type: ticket.ticket_type.clone(),
            source_line: ticket.source_line.clone(),
        });
    }

    database
        .replace_generated_tickets(session_id, &ticket_rows)
        .map_err(|error| error.to_string())?;

    let generated_at = Utc::now().to_rfc3339();
    database
        .update_session_ticket_generation(session_id, "succeeded", None, Some(&generated_at))
        .map_err(|error| error.to_string())?;

    if !generated.warnings.is_empty() {
        append_system_message(state, session_id, &generated.warnings.join(" "))?;
    }

    if generated.tickets.is_empty() {
        append_system_message(
            state,
            session_id,
            "No engineering tickets were generated from this meeting transcript.",
        )?;
    } else {
        append_system_message(
            state,
            session_id,
            &format!(
                "Generated {} draft ticket(s) from this meeting transcript. Review and approve them before pushing to Linear.",
                generated.tickets.len()
            ),
        )?;
    }

    Ok(generated.tickets.len())
}

fn mark_ticket_pushed(
    state: &AppState,
    session_id: &str,
    idempotency_key: &str,
    issue: &LinearIssue,
    linear_deduped: bool,
) -> Result<(), String> {
    state
        .database()
        .mark_generated_ticket_pushed(
            session_id,
            idempotency_key,
            &issue.id,
            &issue.identifier,
            &issue.url,
            &Utc::now().to_rfc3339(),
            linear_deduped,
        )
        .map_err(|error| error.to_string())
}

fn linear_issue_from_match(issue: &LinearIssueMatch) -> LinearIssue {
    LinearIssue {
        id: issue.id.clone(),
        identifier: issue.identifier.clone(),
        title: issue.title.clone(),
        url: issue.url.clone(),
    }
}

async fn push_generated_ticket_inner(
    state: &AppState,
    session_id: &str,
    idempotency_key: &str,
) -> Result<TicketPushOutcome, String> {
    let database = state.database();
    let Some(ticket) = database
        .get_generated_ticket(session_id, idempotency_key)
        .map_err(|error| error.to_string())?
    else {
        return Err("generated ticket not found".to_string());
    };

    if ticket.linear_push_state == "pushed"
        && ticket.linear_issue_id.is_some()
        && ticket.linear_issue_key.is_some()
        && ticket.linear_issue_url.is_some()
    {
        return Ok(TicketPushOutcome {
            status: TicketPushStatus::AlreadyPushed,
            warning: None,
        });
    }

    if !matches!(ticket.review_state.as_str(), "approved" | "push_failed") {
        return Err("Approve the ticket draft before pushing it to Linear.".to_string());
    }

    let Some(linear_config) = load_linear_config(state)? else {
        let message = "Linear API key and team ID are required before TPMCluely can push tickets.";
        let attempted_at = Utc::now().to_rfc3339();
        database
            .mark_generated_ticket_push_failed(session_id, idempotency_key, message, &attempted_at)
            .map_err(|error| error.to_string())?;
        return Ok(TicketPushOutcome {
            status: TicketPushStatus::Failed,
            warning: Some(message.to_string()),
        });
    };

    let linear_dedupe_key = build_linear_dedupe_key(session_id, idempotency_key);
    let marker = build_linear_dedupe_marker(&linear_dedupe_key);
    let remote_matches = match find_issues_by_marker(
        &linear_config.api_key,
        &linear_config.team_id,
        &marker,
    )
    .await
    {
        Ok(matches) => matches,
        Err(error) => {
            let message = error.to_string();
            let attempted_at = Utc::now().to_rfc3339();
            database
                .mark_generated_ticket_push_failed(
                    session_id,
                    idempotency_key,
                    &message,
                    &attempted_at,
                )
                .map_err(|db_error| db_error.to_string())?;
            return Ok(TicketPushOutcome {
                status: TicketPushStatus::Failed,
                warning: Some(message),
            });
        }
    };

    if !remote_matches.is_empty() {
        let canonical = choose_canonical_issue(&remote_matches)
            .ok_or_else(|| "Linear issue lookup returned no canonical issue.".to_string())?;
        let linked_issue = linear_issue_from_match(&canonical);
        mark_ticket_pushed(state, session_id, idempotency_key, &linked_issue, true)?;

        let warning = if remote_matches.len() > 1 {
            let message = format!(
                "Multiple existing Linear issues matched ticket \"{}\". TPMCluely linked the earliest issue {}.",
                ticket.title, canonical.identifier
            );
            append_system_message(state, session_id, &message)?;
            Some(message)
        } else {
            None
        };

        return Ok(TicketPushOutcome {
            status: TicketPushStatus::LinkedExisting,
            warning,
        });
    }

    let acceptance_criteria =
        serde_json::from_str::<Vec<String>>(&ticket.acceptance_criteria).unwrap_or_default();
    let created_issue = match create_issue(
        &linear_config.api_key,
        &linear_config.team_id,
        &LinearIssueRequest {
            title: ticket.title.clone(),
            description: ticket.description.clone(),
            acceptance_criteria,
            idempotency_key: Some(ticket.idempotency_key.clone()),
            linear_dedupe_key: Some(linear_dedupe_key),
        },
    )
    .await
    {
        Ok(issue) => issue,
        Err(error) => {
            let message = error.to_string();
            let attempted_at = Utc::now().to_rfc3339();
            database
                .mark_generated_ticket_push_failed(
                    session_id,
                    idempotency_key,
                    &message,
                    &attempted_at,
                )
                .map_err(|db_error| db_error.to_string())?;
            return Ok(TicketPushOutcome {
                status: TicketPushStatus::Failed,
                warning: Some(message),
            });
        }
    };

    mark_ticket_pushed(state, session_id, idempotency_key, &created_issue, false)?;
    Ok(TicketPushOutcome {
        status: TicketPushStatus::Created,
        warning: None,
    })
}

async fn push_generated_tickets_inner(
    state: &AppState,
    session_id: &str,
) -> Result<TicketPushSummary, String> {
    let database = state.database();
    let tickets = database
        .list_generated_tickets(session_id)
        .map_err(|error| error.to_string())?;
    let mut summary = TicketPushSummary::default();

    for ticket in tickets.iter().filter(|ticket| {
        (ticket.linear_push_state == "pending" || ticket.linear_push_state == "failed")
            && matches!(ticket.review_state.as_str(), "approved" | "push_failed")
    }) {
        let outcome =
            push_generated_ticket_inner(state, session_id, &ticket.idempotency_key).await?;
        let _ = outcome.warning.as_deref();

        match outcome.status {
            TicketPushStatus::Created => summary.created += 1,
            TicketPushStatus::LinkedExisting => summary.linked += 1,
            TicketPushStatus::Failed => summary.failed += 1,
            TicketPushStatus::AlreadyPushed => {}
        }
    }

    append_system_message(
        state,
        session_id,
        &format!(
            "Linear sync finished: created {}, linked {}, failed {}.",
            summary.created, summary.linked, summary.failed
        ),
    )?;

    Ok(summary)
}

fn load_nonempty_secret(state: &AppState, key: &str) -> Result<Option<String>, String> {
    state
        .secret_store()
        .read_secret(key)
        .map_err(|error| error.to_string())
        .map(|value| value.filter(|secret| !secret.trim().is_empty()))
}

fn load_gemini_api_key(state: &AppState) -> Result<Option<String>, String> {
    load_nonempty_secret(state, "gemini_api_key")
}

fn load_deepgram_api_key(state: &AppState) -> Result<Option<String>, String> {
    load_nonempty_secret(state, "deepgram_api_key")
}

fn enqueue_search_reindex(state: &AppState, session_id: &str) {
    let _ = state.search_runtime().enqueue_session_reindex(session_id);
}

fn load_active_prompt_id(settings: &[SettingRecord]) -> Option<&str> {
    settings
        .iter()
        .find(|setting| setting.key == "active_prompt_id" && !setting.value.trim().is_empty())
        .map(|setting| setting.value.as_str())
}

fn load_session_prompt_context(
    state: &AppState,
    session_id: &str,
) -> Result<(String, Option<String>), String> {
    state
        .database()
        .get_session_prompt_context(session_id)
        .map_err(|error| error.to_string())
        .map(|context| match context {
            Some(context) => (
                context.output_language,
                context
                    .prompt_snapshot
                    .filter(|snapshot| !snapshot.trim().is_empty()),
            ),
            None => ("en".to_string(), None),
        })
}

fn map_search_result(row: SearchResultRow) -> SearchResultPayload {
    SearchResultPayload {
        session_id: row.session_id,
        title: row.title,
        status: row.status,
        updated_at: row.updated_at,
        snippet: row.snippet,
        matched_field: row.matched_field,
        match_label: row.match_label,
        retrieval_mode: row.retrieval_mode,
        transcript_sequence_start: row.transcript_sequence_start,
        transcript_sequence_end: row.transcript_sequence_end,
    }
}

fn load_session_detail(
    state: &AppState,
    session_id: &str,
) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    let session = database
        .get_session(session_id)
        .map_err(|error| error.to_string())?;

    match session {
        Some(session_row) => {
            let speakers = database
                .list_session_speakers(session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(map_session_speaker)
                .collect::<Vec<_>>();
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
                speakers,
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
    let permission_diagnostics = state.permissions().diagnostics();
    let settings = state
        .database()
        .list_settings()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| SettingRecord { key, value })
        .collect::<Vec<_>>();
    let database_ready = state.database().healthcheck().is_ok();
    let keychain_available = state
        .secret_store()
        .read_secret("__tpmcluely_healthcheck__")
        .is_ok();
    let prompts = list_prompts(state.database().as_ref(), load_active_prompt_id(&settings))?;
    let knowledge_files = list_files(state.database().as_ref())?;

    let secrets = state
        .secret_store()
        .presence()
        .map_err(|error| error.to_string())?;

    Ok(BootstrapPayload {
        app_name: "TPMCluely".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        permissions,
        settings,
        secrets: secret_snapshot(&secrets),
        providers: state.providers().snapshot(&secrets),
        diagnostics: DiagnosticsSnapshot {
            mode: "desktop",
            build_target: "tauri",
            keychain_available,
            database_ready,
            state_machine_ready: state.session_manager().is_ready(),
            window_controller_ready: state.window_controller().is_ready(),
            search_ready: database_ready,
            semantic_search_ready: database_ready && secrets.gemini_configured,
            prompt_library_ready: database_ready,
            knowledge_library_ready: database_ready,
            export_ready: database_ready,
            permission_detection_ready: permission_diagnostics.accessibility_detection_ready
                || permission_diagnostics.microphone_detection_ready
                || permission_diagnostics.screen_recording_detection_ready,
            capture_backend: state.audio_runtime().diagnostics().capture_backend,
            database_path: state.database().path().to_string_lossy().to_string(),
        },
        capture_capabilities: state.audio_runtime().capture().capabilities(),
        runtime: RuntimeSnapshot {
            session: state.session_manager().snapshot(),
            window: state.window_controller().snapshot(),
        },
        prompts,
        knowledge_files,
    })
}

#[tauri::command]
pub async fn run_preflight_checks(
    state: State<'_, AppState>,
) -> Result<PreflightReportPayload, String> {
    let state = state.inner().clone();
    let permissions = state.permissions().snapshot();
    let settings = load_settings_map(&state)?;
    let capture_capabilities = state.audio_runtime().capture().capabilities();

    let database_ready = state.database().healthcheck().is_ok();
    let keychain_ready = state.secret_store().presence().is_ok();
    let gemini_api_key = load_gemini_api_key(&state)?;
    let deepgram_api_key = load_deepgram_api_key(&state)?;
    let linear_config = load_linear_config(&state)?;

    let gemini_ready = gemini_api_key.is_some();
    let deepgram_ready = deepgram_api_key.is_some();
    let linear_ready = linear_config.is_some();

    let gemini_connectivity = match gemini_api_key.as_deref() {
        Some(api_key) => check_llm_connectivity(api_key).await.is_ok(),
        None => false,
    };
    let deepgram_connectivity = match deepgram_api_key.as_deref() {
        Some(api_key) => check_stt_connectivity(api_key, "auto").await.is_ok(),
        None => false,
    };
    let linear_connectivity = match linear_config.as_ref() {
        Some(config) => check_linear_connectivity(&config.api_key, &config.team_id)
            .await
            .is_ok(),
        None => false,
    };

    let preferred_microphone_device_id = settings
        .get("preferred_microphone_device_id")
        .cloned()
        .unwrap_or_default();
    let screen_context_enabled = setting_enabled(&settings, "screen_context_enabled", true);

    Ok(build_preflight_report(PreflightInputs {
        checked_at: Utc::now().to_rfc3339(),
        permissions,
        capture_capabilities,
        database_ready,
        keychain_ready,
        gemini_ready,
        gemini_connectivity,
        deepgram_ready,
        deepgram_connectivity,
        linear_ready,
        linear_connectivity,
        preferred_microphone_device_id,
        screen_context_enabled,
    }))
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
        .map_err(|error| error.to_string())?;

    if input.key == "gemini_api_key" {
        let _ = state.search_runtime().enqueue_all_sessions();
    }

    Ok(())
}

#[tauri::command]
pub fn read_secret_value(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
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
pub fn list_system_audio_sources(
    state: State<'_, AppState>,
) -> Result<SystemAudioSourceListPayload, String> {
    state
        .audio_runtime()
        .capture()
        .list_system_audio_sources()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_capture_status(
    state: State<'_, AppState>,
    _session_id: String,
) -> Result<CaptureStatePayload, String> {
    Ok(state.audio_runtime().capture().current_state())
}

#[tauri::command]
pub fn start_session(
    state: State<'_, AppState>,
    input: StartSessionInput,
) -> Result<SessionDetailPayload, String> {
    let initial_status = input
        .initial_status
        .clone()
        .unwrap_or_else(|| "active".to_string());
    let session_status = parse_session_status(&initial_status)?;
    let capture_mode = input
        .capture_mode
        .clone()
        .unwrap_or_else(|| "manual".to_string());
    let database = state.database();
    let session = database
        .create_session(
            input.title.trim(),
            &initial_status,
            &capture_mode,
            input.capture_target_kind.as_deref(),
            input.capture_target_label.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    database
        .append_message(
            &session.id,
            "system",
            if initial_status == "preparing" {
                "Session created. Live capture is being verified."
            } else {
                "Session started. Transcript capture is ready."
            },
        )
        .map_err(|error| error.to_string())?;
    state.session_manager().mark_active(&session.id, session_status);

    load_session_detail(&state, &session.id)?
        .ok_or_else(|| "session detail missing after creation".to_string())
}

#[tauri::command]
pub fn update_browser_capture_session(
    state: State<'_, AppState>,
    input: BrowserCaptureSessionUpdateInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let session_status = parse_session_status(&input.status)?;
    let existing_detail = load_session_detail(&state, &input.session_id)?
        .ok_or_else(|| format!("Session {} could not be found.", input.session_id))?;

    let capture_mode = input
        .capture_mode
        .clone()
        .unwrap_or_else(|| existing_detail.session.capture_mode.clone());
    let capture_target_kind = input
        .capture_target_kind
        .clone()
        .or_else(|| existing_detail.session.capture_target_kind.clone());
    let capture_target_label = input
        .capture_target_label
        .clone()
        .or_else(|| existing_detail.session.capture_target_label.clone());

    state
        .database()
        .update_session_capture_metadata(
            &input.session_id,
            &capture_mode,
            capture_target_kind.as_deref(),
            capture_target_label.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    state
        .database()
        .update_session_status(&input.session_id, &input.status, None)
        .map_err(|error| error.to_string())?;
    state
        .session_manager()
        .mark_active(&input.session_id, session_status);

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub async fn start_system_audio_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartSystemAudioCaptureInput,
) -> Result<CaptureStatePayload, String> {
    let audio_language = state
        .database()
        .get_session_prompt_context(&input.session_id)
        .map_err(|error| error.to_string())?
        .map(|context| context.audio_language)
        .unwrap_or_else(|| "auto".to_string());

    state
        .audio_runtime()
        .capture()
        .start_system_audio_capture(
            app,
            state.database(),
            state.secret_store(),
            input,
            audio_language,
        )
        .await
        .map_err(|error| error.to_string())
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
    state
        .session_manager()
        .mark_status(&session_id, SessionStatus::Paused);
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
    state
        .session_manager()
        .mark_status(&session_id, SessionStatus::Active);
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub async fn stop_system_audio_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<CaptureStatePayload, String> {
    state
        .audio_runtime()
        .capture()
        .stop_system_audio_capture(&app, Some(&session_id))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn complete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
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
    enqueue_search_reindex(&state, &session_id);
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
    state.session_manager().clear(&session_id);

    let settings = load_settings_map(&state)?;
    let should_auto_generate = setting_enabled(&settings, "ticket_generation_enabled", true)
        && setting_enabled(&settings, "auto_generate_tickets", true);

    if should_auto_generate {
        let _ = generate_session_tickets_inner(&state, &session_id).await;
    }

    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub async fn generate_session_tickets(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
    generate_session_tickets_inner(&state, &session_id).await?;
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub async fn push_generated_ticket(
    state: State<'_, AppState>,
    input: PushGeneratedTicketInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
    let _ = push_generated_ticket_inner(&state, &input.session_id, &input.idempotency_key).await?;
    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub async fn push_generated_tickets(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
    let _ = push_generated_tickets_inner(&state, &session_id).await?;
    load_session_detail(&state, &session_id)
}

#[tauri::command]
pub fn append_transcript_segment(
    state: State<'_, AppState>,
    input: AppendTranscriptInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let database = state.database();
    database
        .append_transcript_segment(
            &input.session_id,
            input.speaker_id.as_deref(),
            input.speaker_label.as_deref(),
            input.speaker_confidence,
            input.text.trim(),
            input.is_final.unwrap_or(true),
            input.source.as_deref().unwrap_or("manual"),
        )
        .map_err(|error| error.to_string())?;

    let transcripts = database
        .list_transcript_segments(&input.session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    database
        .update_session_derived(&input.session_id, &derived)
        .map_err(|error| error.to_string())?;
    enqueue_search_reindex(state.inner(), &input.session_id);

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn rename_session_speaker(
    state: State<'_, AppState>,
    input: RenameSessionSpeakerInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let trimmed_label = input.display_label.trim();
    if trimmed_label.is_empty() {
        return Err("Speaker name cannot be empty.".to_string());
    }

    let database = state.database();
    database
        .rename_session_speaker(&input.session_id, &input.speaker_id, trimmed_label)
        .map_err(|error| error.to_string())?;

    let transcripts = database
        .list_transcript_segments(&input.session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    database
        .update_session_derived(&input.session_id, &derived)
        .map_err(|error| error.to_string())?;
    enqueue_search_reindex(state.inner(), &input.session_id);

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub async fn run_dynamic_action(
    state: State<'_, AppState>,
    input: RunDynamicActionInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
    let database = state.database();
    let transcripts = database
        .list_transcript_segments(&input.session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);
    let fallback_response = assistant_response_for_action(&input.action, &derived);
    let screen_context = if input.action == "follow_up" {
        input.screen_context.as_ref()
    } else {
        None
    };
    let (output_language, prompt_snapshot) =
        load_session_prompt_context(&state, &input.session_id)?;
    let (response, metadata) = if transcripts.is_empty() {
        let response = insufficient_transcript_message();
        let metadata = build_message_metadata(
            "insufficient_transcript",
            Some("Transcript"),
            None,
            Some(0),
            false,
            None,
            None,
            false,
            &response,
        );
        (response, metadata)
    } else {
        let prompt = build_action_prompt(
            &input.action,
            &transcripts,
            &derived,
            screen_context,
            prompt_snapshot.as_deref(),
            &output_language,
        );
        generate_grounded_response(
            load_gemini_api_key(&state)?,
            ACTION_ASSISTANT_SYSTEM_PROMPT,
            prompt,
            screen_context,
            fallback_response,
            &LlmGenerationOptions::default(),
        )
        .await
    };

    database
        .update_session_derived(&input.session_id, &derived)
        .map_err(|error| error.to_string())?;
    append_assistant_message_with_metadata(
        &state,
        &input.session_id,
        &response,
        screen_context.map(screen_context_snapshot).as_deref(),
        screen_context,
        &metadata,
    )?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub async fn ask_assistant(
    state: State<'_, AppState>,
    input: AskSessionInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let state = state.inner().clone();
    let database = state.database();
    let transcripts = database
        .list_transcript_segments(&input.session_id)
        .map_err(|error| error.to_string())?;
    let derived = derive_session_update(&transcripts);

    let user_context_snapshot = input.screen_context.as_ref().map(screen_context_snapshot);
    database
        .append_message_with_metadata(
            &input.session_id,
            "user",
            &input.prompt,
            user_context_snapshot.as_deref(),
            None,
            None,
            None,
        )
        .map_err(|error| error.to_string())?;
    let messages = database
        .list_messages(&input.session_id)
        .map_err(|error| error.to_string())?;
    let fallback_response = assistant_response_for_prompt(&input.prompt, &derived);
    let (output_language, prompt_snapshot) =
        load_session_prompt_context(&state, &input.session_id)?;
    let (response, mut metadata) = if transcripts.is_empty() {
        let response = insufficient_transcript_message();
        let metadata = build_message_metadata(
            "insufficient_transcript",
            Some("Transcript"),
            None,
            Some(0),
            false,
            None,
            input.screen_capture_wait_ms,
            false,
            &response,
        );
        (response, metadata)
    } else {
        let snippets =
            load_question_snippets(&state, &input.session_id, &input.prompt, &transcripts).await;
        let prompt = build_question_prompt(
            &input.prompt,
            &snippets,
            &messages,
            &derived,
            input.screen_context.as_ref(),
            prompt_snapshot.as_deref(),
            &output_language,
        );
        generate_grounded_response(
            load_gemini_api_key(&state)?,
            MEETING_ASSISTANT_SYSTEM_PROMPT,
            prompt,
            input.screen_context.as_ref(),
            fallback_response,
            &ask_generation_options(),
        )
        .await
    };
    metadata.screen_capture_wait_ms = input.screen_capture_wait_ms;
    append_assistant_message_with_metadata(
        &state,
        &input.session_id,
        &response,
        user_context_snapshot.as_deref(),
        input.screen_context.as_ref(),
        &metadata,
    )?;
    database
        .update_session_derived(&input.session_id, &derived)
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn start_ask_assistant_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AskSessionStreamInput,
) -> Result<AskAssistantStreamStartPayload, String> {
    let state = state.inner().clone();
    let request_id = input.request_id.clone();
    let response_request_id = request_id.clone();
    let user_context_snapshot = input.screen_context.as_ref().map(screen_context_snapshot);
    state
        .database()
        .append_message_with_metadata(
            &input.session_id,
            "user",
            &input.prompt,
            user_context_snapshot.as_deref(),
            None,
            None,
            None,
        )
        .map_err(|error| error.to_string())?;

    let _ = app.emit(
        EVENT_ASSISTANT_STARTED,
        &AssistantStartedPayload {
            request_id: request_id.clone(),
            session_id: input.session_id.clone(),
            prompt: input.prompt.clone(),
            started_at: Utc::now().to_rfc3339(),
            requested_screen_context: input.screen_context.is_some(),
        },
    );

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let request_id = request_id.clone();
        let session_id = input.session_id.clone();

        let outcome = async {
            let database = state.database();
            let transcripts = database
                .list_transcript_segments(&input.session_id)
                .map_err(|error| error.to_string())?;
            let derived = derive_session_update(&transcripts);
            let messages = database
                .list_messages(&input.session_id)
                .map_err(|error| error.to_string())?;
            let fallback_response = assistant_response_for_prompt(&input.prompt, &derived);
            let (output_language, prompt_snapshot) =
                load_session_prompt_context(&state, &input.session_id)?;

            let (response, metadata) = if transcripts.is_empty() {
                let response = insufficient_transcript_message();
                let metadata = build_message_metadata(
                    "insufficient_transcript",
                    Some("Transcript"),
                    None,
                    Some(0),
                    false,
                    None,
                    input.screen_capture_wait_ms,
                    false,
                    &response,
                );
                (response, metadata)
            } else {
                let snippets = load_question_snippets(
                    &state,
                    &input.session_id,
                    &input.prompt,
                    &transcripts,
                )
                .await;
                let prompt = build_question_prompt(
                    &input.prompt,
                    &snippets,
                    &messages,
                    &derived,
                    input.screen_context.as_ref(),
                    prompt_snapshot.as_deref(),
                    &output_language,
                );
                generate_streamed_ask_response(
                    &app_handle,
                    &request_id,
                    &input.session_id,
                    load_gemini_api_key(&state)?,
                    prompt,
                    input.screen_context.as_ref(),
                    fallback_response,
                    input.screen_capture_wait_ms,
                )
                .await
            };

            append_assistant_message_with_metadata(
                &state,
                &input.session_id,
                &response,
                user_context_snapshot.as_deref(),
                input.screen_context.as_ref(),
                &metadata,
            )?;
            database
                .update_session_derived(&input.session_id, &derived)
                .map_err(|error| error.to_string())?;

            load_session_detail(&state, &input.session_id)
        }
        .await;

        match outcome {
            Ok(detail) => {
                let _ = app_handle.emit(
                    EVENT_ASSISTANT_COMPLETED,
                    &AssistantCompletedPayload {
                        request_id,
                        session_id,
                        detail,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    EVENT_ASSISTANT_FAILED,
                    &AssistantFailedPayload {
                        request_id,
                        session_id,
                        error,
                    },
                );
            }
        }
    });

    Ok(AskAssistantStreamStartPayload {
        request_id: response_request_id,
    })
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
pub fn update_generated_ticket_draft(
    state: State<'_, AppState>,
    input: UpdateGeneratedTicketDraftInput,
) -> Result<Option<SessionDetailPayload>, String> {
    let acceptance_criteria =
        serde_json::to_string(&input.acceptance_criteria).map_err(|error| error.to_string())?;
    state
        .database()
        .update_generated_ticket_draft(
            &input.session_id,
            &input.idempotency_key,
            &input.title,
            &input.description,
            &acceptance_criteria,
            &input.ticket_type,
        )
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn set_generated_ticket_review_state(
    state: State<'_, AppState>,
    input: SetGeneratedTicketReviewStateInput,
) -> Result<Option<SessionDetailPayload>, String> {
    if !matches!(
        input.review_state.as_str(),
        "draft" | "approved" | "rejected"
    ) {
        return Err("Unsupported review state transition requested.".to_string());
    }

    state
        .database()
        .set_generated_ticket_review_state(
            &input.session_id,
            &input.idempotency_key,
            &input.review_state,
            input.rejection_reason.as_deref(),
        )
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
            false,
        )
        .map_err(|error| error.to_string())?;

    load_session_detail(&state, &input.session_id)
}

#[tauri::command]
pub fn get_runtime_state(state: State<'_, AppState>) -> RuntimeSnapshot {
    RuntimeSnapshot {
        session: state.session_manager().snapshot(),
        window: state.window_controller().snapshot(),
    }
}

#[tauri::command]
pub fn set_overlay_open(state: State<'_, AppState>, open: bool) -> RuntimeSnapshot {
    state.window_controller().set_overlay_open(open);
    get_runtime_state(state)
}

#[tauri::command]
pub fn set_stealth_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> RuntimeSnapshot {
    use crate::window::set_stealth_enabled;
    if let Some(window) = app.get_webview_window("main") {
        set_stealth_enabled(&window, enabled);
    }
    state.window_controller().set_stealth_active(enabled);
    get_runtime_state(state)
}

#[tauri::command]
pub async fn search_sessions(
    state: State<'_, AppState>,
    query: String,
    mode: Option<String>,
) -> Result<Vec<SearchResultPayload>, String> {
    state
        .search_runtime()
        .search_sessions(&query, mode.as_deref().unwrap_or("lexical"), 25)
        .await
        .map(|rows| rows.into_iter().map(map_search_result).collect())
}

#[tauri::command]
pub fn export_session_markdown(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<ExportSessionPayload>, String> {
    let Some(detail) = load_session_detail(&state, &session_id)? else {
        return Ok(None);
    };

    let markdown = build_session_markdown(&detail);
    let file_name = format!(
        "{}.md",
        detail
            .session
            .title
            .trim()
            .to_lowercase()
            .replace(|character: char| !character.is_ascii_alphanumeric(), "-")
            .split('-')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("-")
    );
    let exports_dir = state.app_dir().join("exports");
    fs::create_dir_all(&exports_dir).map_err(|error| error.to_string())?;
    let storage_path = exports_dir.join(&file_name);
    fs::write(&storage_path, &markdown).map_err(|error| error.to_string())?;
    let artifact_id = state
        .database()
        .insert_session_artifact(
            &session_id,
            "export",
            Some(&storage_path.to_string_lossy()),
            Some("text/markdown"),
            None,
            Some(
                &serde_json::to_string(&serde_json::json!({
                    "fileName": file_name,
                }))
                .map_err(|error| error.to_string())?,
            ),
        )
        .map_err(|error| error.to_string())?;

    Ok(Some(ExportSessionPayload {
        session_id,
        file_name,
        markdown,
        artifact_id: Some(artifact_id),
    }))
}

#[tauri::command]
pub fn list_system_prompts(state: State<'_, AppState>) -> Result<Vec<PromptRecord>, String> {
    let settings = state
        .database()
        .list_settings()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| SettingRecord { key, value })
        .collect::<Vec<_>>();
    list_prompts(state.database().as_ref(), load_active_prompt_id(&settings))
}

#[tauri::command]
pub fn save_system_prompt(
    state: State<'_, AppState>,
    input: SavePromptInput,
) -> Result<Vec<PromptRecord>, String> {
    let settings = state
        .database()
        .list_settings()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| SettingRecord { key, value })
        .collect::<Vec<_>>();
    let saved = save_prompt(
        state.database().as_ref(),
        &input,
        load_active_prompt_id(&settings),
    )?;

    if input.make_active.unwrap_or(false) || load_active_prompt_id(&settings).is_none() {
        state
            .database()
            .save_setting("active_prompt_id", &saved.id)
            .map_err(|error| error.to_string())?;
    }

    list_system_prompts(state)
}

#[tauri::command]
pub fn delete_system_prompt(
    state: State<'_, AppState>,
    prompt_id: String,
) -> Result<Vec<PromptRecord>, String> {
    state
        .database()
        .delete_prompt(&prompt_id)
        .map_err(|error| error.to_string())?;
    list_system_prompts(state)
}

#[tauri::command]
pub fn list_knowledge_files(
    state: State<'_, AppState>,
) -> Result<Vec<KnowledgeFileRecord>, String> {
    list_files(state.database().as_ref())
}

#[tauri::command]
pub fn save_knowledge_file(
    state: State<'_, AppState>,
    input: SaveKnowledgeFileInput,
) -> Result<Vec<KnowledgeFileRecord>, String> {
    ingest_text_file(state.database().as_ref(), &state.app_dir(), &input)?;
    list_knowledge_files(state)
}

#[tauri::command]
pub fn delete_knowledge_file(
    state: State<'_, AppState>,
    knowledge_file_id: String,
) -> Result<Vec<KnowledgeFileRecord>, String> {
    delete_file(state.database().as_ref(), &knowledge_file_id)?;
    list_knowledge_files(state)
}

#[cfg(test)]
mod tests {
    use super::{
        ask_generation_options, build_preflight_report, build_question_prompt, extract_citations,
        format_screen_context_note, generate_grounded_response, map_message,
        parse_session_status, MessageAttachmentPayload, PreflightInputs,
        ScreenContextInput,
    };
    use crate::audio::CaptureCapabilities;
    use crate::db::{MessageRow, SessionDerivedUpdate};
    use crate::permissions::PermissionSnapshot;
    use crate::session::state_machine::SessionStatus;

    #[test]
    fn question_prompt_mentions_screen_context_and_citations() {
        let prompt = build_question_prompt(
            "What should I say about the auth error?",
            &["[S1] Engineer: We need to fix the auth timeout before rollout.".to_string()],
            &[MessageRow {
                id: "msg-1".to_string(),
                session_id: "session-1".to_string(),
                role: "user".to_string(),
                content: "What is the risk?".to_string(),
                context_snapshot: None,
                attachments_json: None,
                metadata_json: None,
                created_at: "2026-03-12T15:00:00Z".to_string(),
            }],
            &SessionDerivedUpdate {
                rolling_summary: Some("Auth rollout and dashboard changes.".to_string()),
                ..SessionDerivedUpdate::default()
            },
            Some(&ScreenContextInput {
                mime_type: "image/jpeg".to_string(),
                data_base64: "abc123".to_string(),
                captured_at: "2026-03-12T15:01:00Z".to_string(),
                width: 1280,
                height: 720,
                source_label: "Shared code editor".to_string(),
                stale_ms: 0,
            }),
            Some("Favor concise, risk-aware answers."),
            "en",
        );

        assert!(prompt.contains("Shared screen context"));
        assert!(prompt.contains("Shared code editor"));
        assert!(prompt.contains("[Screen]"));
        assert!(prompt.contains("[S#]"));
        assert!(prompt.contains("[S#-S#]"));
        assert!(prompt.contains("Favor concise, risk-aware answers."));
    }

    #[test]
    fn map_message_round_trips_attachment_metadata() {
        let attachments = serde_json::to_string(&vec![MessageAttachmentPayload {
            kind: "screenshot".to_string(),
            artifact_id: Some("artifact-1".to_string()),
            mime_type: "image/jpeg".to_string(),
            captured_at: "2026-03-12T15:01:00Z".to_string(),
            width: 1280,
            height: 720,
            source_label: "Shared screen".to_string(),
            persisted: true,
        }])
        .expect("attachments should serialize");

        let payload = map_message(MessageRow {
            id: "msg-1".to_string(),
            session_id: "session-1".to_string(),
            role: "assistant".to_string(),
            content: "Answer".to_string(),
            context_snapshot: Some(format_screen_context_note(Some(&ScreenContextInput {
                mime_type: "image/jpeg".to_string(),
                data_base64: "abc123".to_string(),
                captured_at: "2026-03-12T15:01:00Z".to_string(),
                width: 1280,
                height: 720,
                source_label: "Shared screen".to_string(),
                stale_ms: 0,
            }))),
            attachments_json: Some(attachments),
            metadata_json: None,
            created_at: "2026-03-12T15:01:05Z".to_string(),
        });

        assert_eq!(payload.attachments.len(), 1);
        assert_eq!(payload.attachments[0].kind, "screenshot");
        assert_eq!(
            payload.attachments[0].artifact_id.as_deref(),
            Some("artifact-1")
        );
    }

    #[test]
    fn extract_citations_preserves_unique_transcript_and_screen_references() {
        let citations = extract_citations(
            "Say the rollout is blocked by auth timeouts [S3], note the owner [S9], and reference the shared dashboard [Screen]. Repeat [S3].",
        );

        assert_eq!(citations, vec!["[Screen]", "[S3]", "[S9]"]);
    }

    #[tokio::test]
    async fn grounded_response_without_gemini_key_is_explicit_transcript_fallback() {
        let (response, metadata) = generate_grounded_response(
            None,
            "system",
            "prompt".to_string(),
            None,
            "Transcript-backed fallback [S4]".to_string(),
            &ask_generation_options(),
        )
        .await;

        assert_eq!(response, "Transcript-backed fallback [S4]");
        assert_eq!(
            metadata.response_mode.as_deref(),
            Some("transcript_fallback")
        );
        assert_eq!(metadata.provider_name.as_deref(), Some("Gemini"));
        assert_eq!(
            metadata.provider_error.as_deref(),
            Some("Gemini API key is not configured.")
        );
        assert_eq!(metadata.citations, vec!["[S4]"]);
        assert!(!metadata.used_screen_context);
    }

    #[test]
    fn preflight_report_blocks_microphone_without_deepgram_and_keeps_manual_ready() {
        let report = build_preflight_report(PreflightInputs {
            checked_at: "2026-03-13T15:00:00Z".to_string(),
            permissions: PermissionSnapshot {
                screen_recording: "unknown",
                microphone: "granted",
                accessibility: "unknown",
            },
            capture_capabilities: CaptureCapabilities {
                native_system_audio: false,
                screen_recording_required: true,
                microphone_fallback: true,
            },
            database_ready: true,
            keychain_ready: true,
            gemini_ready: false,
            gemini_connectivity: false,
            deepgram_ready: false,
            deepgram_connectivity: false,
            linear_ready: false,
            linear_connectivity: false,
            preferred_microphone_device_id: String::new(),
            screen_context_enabled: true,
        });

        let manual = report
            .modes
            .iter()
            .find(|mode| mode.mode == "manual")
            .expect("manual mode should exist");
        let microphone = report
            .modes
            .iter()
            .find(|mode| mode.mode == "microphone")
            .expect("microphone mode should exist");
        let deepgram_key = report
            .checks
            .iter()
            .find(|check| check.key == "deepgram_key")
            .expect("deepgram key check should exist");

        assert!(manual.can_start);
        assert_eq!(manual.state, "ready");
        assert!(!microphone.can_start);
        assert_eq!(microphone.state, "blocked");
        assert_eq!(deepgram_key.status, "blocked");
        assert!(microphone.summary.contains("blocked"));
    }

    #[test]
    fn preflight_report_marks_system_audio_ready_when_permissions_and_connectivity_exist() {
        let report = build_preflight_report(PreflightInputs {
            checked_at: "2026-03-13T15:00:00Z".to_string(),
            permissions: PermissionSnapshot {
                screen_recording: "granted",
                microphone: "granted",
                accessibility: "granted",
            },
            capture_capabilities: CaptureCapabilities {
                native_system_audio: true,
                screen_recording_required: true,
                microphone_fallback: true,
            },
            database_ready: true,
            keychain_ready: true,
            gemini_ready: true,
            gemini_connectivity: true,
            deepgram_ready: true,
            deepgram_connectivity: true,
            linear_ready: true,
            linear_connectivity: true,
            preferred_microphone_device_id: "built-in-mic".to_string(),
            screen_context_enabled: true,
        });

        let system_audio = report
            .modes
            .iter()
            .find(|mode| mode.mode == "system_audio")
            .expect("system-audio mode should exist");
        let screen_context = report
            .checks
            .iter()
            .find(|check| check.key == "screen_context")
            .expect("screen context check should exist");

        assert!(system_audio.can_start);
        assert_eq!(system_audio.state, "verification_required");
        assert_eq!(screen_context.status, "ready");
        assert!(system_audio.summary.contains("verifies a shareable source on this machine"));
    }

    #[test]
    fn parse_session_status_accepts_preparing_and_live_error_states() {
        assert!(matches!(
            parse_session_status("preparing"),
            Ok(SessionStatus::Preparing)
        ));
        assert!(matches!(
            parse_session_status("permission_blocked"),
            Ok(SessionStatus::PermissionBlocked)
        ));
        assert!(matches!(
            parse_session_status("capture_error"),
            Ok(SessionStatus::CaptureError)
        ));
        assert!(matches!(
            parse_session_status("provider_degraded"),
            Ok(SessionStatus::ProviderDegraded)
        ));
        assert!(parse_session_status("completed").is_err());
    }
}
