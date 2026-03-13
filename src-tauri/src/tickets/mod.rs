use hex::encode as hex_encode;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::providers::llm::{generate_json, LlmProviderError};

const MAX_TRANSCRIPT_CHARS: usize = 150_000;
const TARGET_MODEL_TRANSCRIPT_CHARS: usize = 22_000;
const HEAD_SECTION_CHARS: usize = 7_500;
const TAIL_SECTION_CHARS: usize = 7_500;
const ACTION_SECTION_BUDGET_CHARS: usize = 5_500;
const ACTION_LINE_REGEX: &str = r"\b(todo|action item|bug|fix|implement|ship|owner|assigned|deadline|decided|decision|follow[- ]?up|ticket|blocker|regression|incident|eta|next step)\b";

const TICKET_PROMPT: &str = r#"You are a principal technical program manager.
Analyze the meeting transcript and produce engineering tickets.

Output requirements:
- Return ONLY a JSON array (no markdown, no prose)
- Each ticket object must contain:
  - "title": concise, implementation-ready title
  - "description": technical context, motivation, and details from discussion
  - "acceptance_criteria": array of measurable, testable criteria
  - "type": exactly one of "Bug", "Feature", or "Task"

Quality rules:
- Create tickets only for clearly supported engineering work items
- If the meeting only supports one ticket, return one ticket
- If the meeting supports multiple distinct work items, return multiple tickets
- It is acceptable to return an empty array if no concrete engineering ticket should be created
- Keep titles specific and action-oriented
- Avoid duplicates
- Ensure every acceptance criterion can be objectively verified
- Treat speaker-attributed commitments as grounded ownership evidence only when the transcript explicitly supports that attribution
- Do not invent owners, assignees, or certainty when the transcript is unattributed or ambiguous"#;

const REPAIR_PROMPT: &str = r#"Repair the provided content into a strict JSON array of ticket objects.
Rules:
- Output only JSON array
- Required keys: title, description, acceptance_criteria, type
- type must be Bug, Feature, or Task
- acceptance_criteria must be an array of strings
- Remove invalid entries instead of inventing unsupported facts"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketCandidate {
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    #[serde(rename = "type")]
    pub ticket_type: String,
    pub idempotency_key: String,
    pub source_line: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TicketGenerationResult {
    pub tickets: Vec<TicketCandidate>,
    pub warnings: Vec<String>,
    pub raw_ticket_count: usize,
}

#[derive(Debug, Error)]
pub enum TicketError {
    #[error("llm error: {0}")]
    Llm(#[from] LlmProviderError),
    #[error("transcript is empty")]
    EmptyTranscript,
    #[error("transcript is too large ({0} chars)")]
    TranscriptTooLarge(usize),
    #[error("ticket payload could not be parsed")]
    InvalidPayload,
}

#[derive(Debug, Deserialize)]
struct RawTicket {
    title: Option<String>,
    description: Option<String>,
    acceptance_criteria: Option<Vec<String>>,
    #[serde(rename = "type")]
    ticket_type: Option<String>,
}

fn normalize_string(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_transcript(raw_transcript: &str) -> String {
    raw_transcript
        .replace("\r\n", "\n")
        .replace('\t', "  ")
        .trim()
        .to_string()
}

fn collect_action_lines(input: &str, budget_chars: usize) -> String {
    let regex = Regex::new(ACTION_LINE_REGEX).expect("action line regex should compile");
    let mut seen = std::collections::HashSet::new();
    let mut selected = Vec::new();
    let mut total_chars = 0;

    for line in input
        .lines()
        .map(str::trim)
        .filter(|line| line.len() >= 12 && regex.is_match(line))
    {
        let normalized = line.to_lowercase();
        if seen.contains(&normalized) {
            continue;
        }

        let next_total = total_chars + line.len() + 1;
        if next_total > budget_chars {
            break;
        }

        selected.push(line.to_string());
        seen.insert(normalized);
        total_chars = next_total;
    }

    selected.join("\n")
}

fn truncate_middle(input: &str, max_chars: usize) -> String {
    if input.len() <= max_chars {
        return input.to_string();
    }

    let head_chars = (max_chars as f64 * 0.55) as usize;
    let tail_chars = max_chars.saturating_sub(head_chars + 40);
    format!(
        "{}\n\n[... trimmed for length ...]\n\n{}",
        &input[..head_chars.min(input.len())],
        &input[input.len().saturating_sub(tail_chars)..]
    )
}

fn prepare_transcript_for_model(
    raw_transcript: &str,
) -> Result<(String, Vec<String>), TicketError> {
    let normalized = normalize_transcript(raw_transcript);
    let original_chars = normalized.len();

    if original_chars == 0 {
        return Err(TicketError::EmptyTranscript);
    }
    if original_chars > MAX_TRANSCRIPT_CHARS {
        return Err(TicketError::TranscriptTooLarge(original_chars));
    }
    if original_chars <= TARGET_MODEL_TRANSCRIPT_CHARS {
        return Ok((normalized, Vec::new()));
    }

    let head = normalized[..HEAD_SECTION_CHARS.min(normalized.len())].trim_end();
    let tail_start = normalized.len().saturating_sub(TAIL_SECTION_CHARS);
    let tail = normalized[tail_start..].trim_start();
    let middle = if normalized.len() > HEAD_SECTION_CHARS + TAIL_SECTION_CHARS {
        &normalized[HEAD_SECTION_CHARS..tail_start]
    } else {
        ""
    };
    let action_lines = collect_action_lines(middle, ACTION_SECTION_BUDGET_CHARS);

    let assembled = [
        head,
        "",
        "[... middle section omitted for token safety ...]",
        if action_lines.is_empty() {
            "No high-signal action lines were detected in the omitted middle section."
        } else {
            ""
        },
        if action_lines.is_empty() {
            ""
        } else {
            "Key action-oriented lines extracted from omitted middle section:"
        },
        action_lines.as_str(),
        "",
        tail,
    ]
    .join("\n");

    let condensed = truncate_middle(&assembled, TARGET_MODEL_TRANSCRIPT_CHARS);
    Ok((
        condensed.clone(),
        vec![format!(
            "Transcript was condensed from {original_chars} to {} characters to control cost and latency.",
            condensed.len()
        )],
    ))
}

fn extract_json_array(response_text: &str) -> Result<String, TicketError> {
    let normalized = response_text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    if normalized.starts_with('[') && normalized.ends_with(']') {
        return Ok(normalized);
    }

    let start = normalized.find('[').ok_or(TicketError::InvalidPayload)?;
    let end = normalized.rfind(']').ok_or(TicketError::InvalidPayload)?;
    if end <= start {
        return Err(TicketError::InvalidPayload);
    }

    Ok(normalized[start..=end].to_string())
}

fn normalize_type(value: &str) -> String {
    let normalized = value.to_lowercase();
    if normalized.contains("bug") {
        "Bug".to_string()
    } else if normalized.contains("feature") {
        "Feature".to_string()
    } else {
        "Task".to_string()
    }
}

fn build_idempotency_key(ticket_type: &str, title: &str, criteria: &[String]) -> String {
    let signature = format!(
        "{}|{}|{}",
        ticket_type,
        title.to_lowercase(),
        criteria
            .iter()
            .map(|criterion| criterion.to_lowercase())
            .collect::<Vec<_>>()
            .join("|")
    );
    let mut hasher = Sha256::new();
    hasher.update(signature.as_bytes());
    hex_encode(hasher.finalize())[..24].to_string()
}

fn normalize_and_validate_tickets(raw_tickets: Vec<RawTicket>) -> Vec<TicketCandidate> {
    let mut seen = std::collections::HashSet::new();
    let mut tickets = Vec::new();

    for raw_ticket in raw_tickets {
        let title = normalize_string(raw_ticket.title.as_deref().unwrap_or(""));
        let description = normalize_string(raw_ticket.description.as_deref().unwrap_or(""));
        let acceptance_criteria = raw_ticket
            .acceptance_criteria
            .unwrap_or_default()
            .into_iter()
            .map(|criterion| normalize_string(&criterion))
            .filter(|criterion| criterion.len() >= 3 && criterion.len() <= 280)
            .collect::<Vec<_>>();
        let ticket_type = normalize_type(raw_ticket.ticket_type.as_deref().unwrap_or("Task"));

        if title.len() < 5 || description.len() < 12 || acceptance_criteria.is_empty() {
            continue;
        }

        let dedupe_key = format!(
            "{}|{}|{}",
            ticket_type,
            title.to_lowercase(),
            acceptance_criteria
                .iter()
                .map(|criterion| criterion.to_lowercase())
                .collect::<Vec<_>>()
                .join("|")
        );

        if seen.contains(&dedupe_key) {
            continue;
        }
        seen.insert(dedupe_key);
        let idempotency_key = build_idempotency_key(&ticket_type, &title, &acceptance_criteria);

        tickets.push(TicketCandidate {
            title,
            description,
            acceptance_criteria: acceptance_criteria.clone(),
            ticket_type: ticket_type.clone(),
            idempotency_key,
            source_line: None,
        });
    }

    tickets
}

pub async fn generate_tickets(
    transcript: &str,
    api_key: &str,
) -> Result<TicketGenerationResult, TicketError> {
    let (prepared_transcript, warnings) = prepare_transcript_for_model(transcript)?;
    let prompt = format!("Meeting transcript to analyze:\n\n{prepared_transcript}");

    let raw_response = generate_json(api_key, TICKET_PROMPT, &prompt).await?;
    let parsed = match extract_json_array(&raw_response)
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<RawTicket>>(&json).ok())
    {
        Some(value) => value,
        None => {
            let repaired = generate_json(
                api_key,
                REPAIR_PROMPT,
                &format!("Broken response to repair:\n\n{raw_response}"),
            )
            .await?;
            let repaired_json = extract_json_array(&repaired)?;
            serde_json::from_str::<Vec<RawTicket>>(&repaired_json)
                .map_err(|_| TicketError::InvalidPayload)?
        }
    };

    let raw_ticket_count = parsed.len();

    Ok(TicketGenerationResult {
        tickets: normalize_and_validate_tickets(parsed),
        warnings,
        raw_ticket_count,
    })
}
