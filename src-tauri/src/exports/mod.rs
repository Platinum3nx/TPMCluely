use crate::app::commands::SessionDetailPayload;

pub fn build_session_markdown(detail: &SessionDetailPayload) -> String {
    let transcript = detail
        .transcripts
        .iter()
        .map(|segment| format!("- {}: {}", segment.speaker_label.as_deref().unwrap_or("Speaker"), segment.text))
        .collect::<Vec<_>>()
        .join("\n");
    let tickets = detail
        .generated_tickets
        .iter()
        .map(|ticket| {
            let acceptance = if ticket.acceptance_criteria.is_empty() {
                "- No acceptance criteria.".to_string()
            } else {
                ticket
                    .acceptance_criteria
                    .iter()
                    .map(|criterion| format!("- {criterion}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            format!(
                "### {} ({})\n\n{}\n\n{}\n",
                ticket.title, ticket.ticket_type, ticket.description, acceptance
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    [
        format!("# {}", detail.session.title),
        String::new(),
        format!("Status: {}", detail.session.status),
        format!("Started: {}", detail.session.started_at.as_deref().unwrap_or("n/a")),
        format!("Ended: {}", detail.session.ended_at.as_deref().unwrap_or("n/a")),
        String::new(),
        "## Summary".to_string(),
        detail
            .session
            .final_summary
            .clone()
            .unwrap_or_else(|| "No summary available yet.".to_string()),
        String::new(),
        "## Decisions".to_string(),
        detail
            .session
            .decisions_md
            .clone()
            .unwrap_or_else(|| "- None yet.".to_string()),
        String::new(),
        "## Action Items".to_string(),
        detail
            .session
            .action_items_md
            .clone()
            .unwrap_or_else(|| "- None yet.".to_string()),
        String::new(),
        "## Notes".to_string(),
        detail
            .session
            .notes_md
            .clone()
            .unwrap_or_else(|| "- None yet.".to_string()),
        String::new(),
        "## Transcript".to_string(),
        if transcript.is_empty() {
            "- No transcript available yet.".to_string()
        } else {
            transcript
        },
        String::new(),
        "## Tickets".to_string(),
        if tickets.is_empty() {
            "No generated tickets.".to_string()
        } else {
            tickets
        },
    ]
    .join("\n")
}
