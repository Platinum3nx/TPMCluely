use std::collections::HashSet;

use crate::db::TranscriptRow;

pub fn format_transcript_document(transcripts: &[TranscriptRow]) -> String {
    transcripts
        .iter()
        .map(|segment| {
            let speaker = segment
                .speaker_label
                .as_deref()
                .unwrap_or("Unattributed")
                .trim();
            format!("{speaker}: {}", segment.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn truncate_context_middle(input: &str, max_chars: usize) -> String {
    if input.len() <= max_chars {
        return input.to_string();
    }

    let head_chars = (max_chars as f64 * 0.6) as usize;
    let tail_chars = max_chars.saturating_sub(head_chars + 36);
    format!(
        "{}\n\n[... transcript truncated ...]\n\n{}",
        &input[..head_chars.min(input.len())],
        &input[input.len().saturating_sub(tail_chars)..]
    )
}

pub fn select_relevant_transcript_snippets(
    transcripts: &[TranscriptRow],
    prompt: &str,
) -> Vec<String> {
    let stop_words = [
        "the", "and", "that", "with", "from", "about", "what", "when", "where", "does", "have",
        "will", "this", "they", "them", "into", "for", "you", "your", "were", "could",
    ]
    .into_iter()
    .collect::<HashSet<_>>();

    let prompt_terms = prompt
        .split(|character: char| !character.is_alphanumeric())
        .filter_map(|term| {
            let normalized = term.trim().to_lowercase();
            if normalized.len() < 3 || stop_words.contains(normalized.as_str()) {
                None
            } else {
                Some(normalized)
            }
        })
        .collect::<HashSet<_>>();

    let mut scored = transcripts
        .iter()
        .map(|segment| {
            let normalized = segment.text.to_lowercase();
            let overlap = prompt_terms
                .iter()
                .filter(|term| normalized.contains(term.as_str()))
                .count() as i64;
            let recency_bonus = segment.sequence_no;
            (overlap * 100 + recency_bonus, segment)
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| right.0.cmp(&left.0));

    let mut selected = scored
        .into_iter()
        .filter(|(score, _)| *score > 0)
        .take(6)
        .map(|(_, segment)| segment)
        .collect::<Vec<_>>();

    for segment in transcripts.iter().rev().take(4).rev() {
        if !selected.iter().any(|candidate| candidate.id == segment.id) {
            selected.push(segment);
        }
    }

    selected
        .into_iter()
        .map(|segment| {
            format!(
                "[S{}] {}: {}",
                segment.sequence_no,
                segment
                    .speaker_label
                    .as_deref()
                    .unwrap_or("Unattributed"),
                segment.text.trim()
            )
        })
        .collect()
}
