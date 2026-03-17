use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::Notify;

use crate::db::AppDatabase;
use crate::providers::llm::{generate_text_with_options, LlmGenerationOptions};
use crate::secrets::AppSecretStore;

const INSIGHTS_JOB_POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct InsightsEngine {
    database: Arc<AppDatabase>,
    secret_store: Arc<dyn AppSecretStore>,
    notify: Arc<Notify>,
}

#[derive(Debug, Deserialize)]
struct InsightsAnalysisResult {
    topics: Vec<InsightTopic>,
    blockers: Vec<InsightBlocker>,
}

#[derive(Debug, Deserialize)]
struct InsightTopic {
    id: String,
    topic: String,
    representative_snippet: Option<String>,
    matching_session_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct InsightBlocker {
    id: String,
    description: String,
    matching_session_ids: Vec<String>,
    resolved: bool,
}

impl InsightsEngine {
    pub fn new(database: Arc<AppDatabase>, secret_store: Arc<dyn AppSecretStore>) -> Self {
        Self {
            database,
            secret_store,
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn enqueue_analysis(&self, session_id: &str) {
        let _ = self.database.enqueue_insights_job(session_id);
        self.notify.notify_one();
    }

    pub fn start(&self) {
        let engine = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let _ = engine.process_next_job().await;
                tokio::select! {
                    _ = engine.notify.notified() => {}
                    _ = tokio::time::sleep(INSIGHTS_JOB_POLL_INTERVAL) => {}
                }
            }
        });
    }

    async fn process_next_job(&self) -> Result<(), String> {
        let Some(session_id) = self.database.take_next_insights_job().map_err(|e| e.to_string())? else {
            return Ok(());
        };

        match self.analyze_completed_session(&session_id).await {
            Ok(()) => {
                let _ = self.database.complete_insights_job(&session_id);
            }
            Err(error) => {
                let _ = self.database.fail_insights_job(&session_id, &error);
            }
        }

        Ok(())
    }

    async fn analyze_completed_session(&self, session_id: &str) -> Result<(), String> {
        let gemini_api_key = self
            .secret_store
            .read_secret("gemini_api_key")
            .map_err(|e| e.to_string())?
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| "Gemini API key not configured".to_string())?;

        let database = &self.database;

        let new_session = database
            .get_session(session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Session not found".to_string())?;

        let all_sessions = database
            .list_sessions()
            .map_err(|e| e.to_string())?;

        // Build context from other completed sessions
        let other_summaries: Vec<String> = all_sessions
            .iter()
            .filter(|s| s.id != session_id && s.status == "completed")
            .filter_map(|s| {
                let title = &s.title;
                let summary = s.final_summary.as_deref().unwrap_or("").trim();
                let date = s.ended_at.as_deref().unwrap_or(s.updated_at.as_str());
                if summary.is_empty() {
                    None
                } else {
                    Some(format!("Session: \"{title}\" ({date})\nSummary: {summary}"))
                }
            })
            .collect();

        let new_session_text = format!(
            "Title: {}\nSummary: {}\nDecisions: {}\nAction Items: {}",
            new_session.title,
            new_session.final_summary.as_deref().unwrap_or(""),
            new_session.decisions_md.as_deref().unwrap_or(""),
            new_session.action_items_md.as_deref().unwrap_or(""),
        );
        let session_date = new_session.ended_at.as_deref().unwrap_or(new_session.updated_at.as_str());

        let other_sessions_text = if other_summaries.is_empty() {
            "No prior sessions available.".to_string()
        } else {
            other_summaries.join("\n\n---\n\n")
        };

        // Build session ID map for matching
        let session_map: std::collections::HashMap<String, (&str, &str)> = all_sessions
            .iter()
            .map(|s| {
                let date = s.ended_at.as_deref().unwrap_or(s.updated_at.as_str());
                (s.id.clone(), (s.title.as_str(), date))
            })
            .collect();

        let prompt = format!(
            r#"You are a meeting intelligence analyzer. Analyze the new session and prior sessions to identify recurring topics and blockers.

NEW SESSION:
{new_session_text}

PRIOR SESSIONS:
{other_sessions_text}

Instructions:
1. Extract 3-8 key topics from the NEW SESSION
2. For each topic, check if it appears in any PRIOR SESSIONS (match by semantic similarity of the concept)
3. Identify recurring blockers mentioned in action items or decisions
4. For each blocker, check if it appeared in prior sessions

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{{
  "topics": [
    {{
      "id": "unique_stable_id_based_on_topic_name",
      "topic": "Short topic label (3-8 words)",
      "representative_snippet": "A brief quote or description from the new session",
      "matching_session_ids": ["session_id_1", "session_id_2"]
    }}
  ],
  "blockers": [
    {{
      "id": "unique_stable_id_based_on_blocker",
      "description": "Brief blocker description",
      "matching_session_ids": ["session_id_1"],
      "resolved": false
    }}
  ]
}}

PRIOR SESSION IDs for matching:
{}
"#,
            all_sessions.iter()
                .filter(|s| s.id != session_id && s.status == "completed")
                .map(|s| format!("  {} -> \"{}\"", s.id, s.title))
                .collect::<Vec<_>>()
                .join("\n")
        );

        let response = generate_text_with_options(
            &gemini_api_key,
            "You are a meeting intelligence analyzer. Return only valid JSON.",
            &prompt,
            &LlmGenerationOptions {
                max_output_tokens: Some(2048),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;

        // Parse JSON (strip markdown fences if present)
        let json_text = response
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        let analysis: InsightsAnalysisResult = serde_json::from_str(json_text)
            .map_err(|e| format!("Failed to parse insights JSON: {e}"))?;

        // Upsert topics
        for topic in &analysis.topics {
            // Find min/max dates across matching sessions
            let matching_dates: Vec<&str> = topic
                .matching_session_ids
                .iter()
                .filter_map(|id| session_map.get(id).map(|(_, date)| *date))
                .collect();
            let first_seen = matching_dates
                .iter()
                .min()
                .copied()
                .unwrap_or(session_date);
            let last_seen = session_date;

            let occurrence_count = (topic.matching_session_ids.len() as i64 + 1).max(1);

            database
                .upsert_insight_topic(
                    &topic.id,
                    &topic.topic,
                    topic.representative_snippet.as_deref(),
                    first_seen,
                    last_seen,
                    occurrence_count,
                )
                .map_err(|e| e.to_string())?;

            // Link current session
            database
                .link_topic_to_session(&topic.id, session_id, &new_session.title, session_date)
                .map_err(|e| e.to_string())?;

            // Link matching prior sessions
            for matching_id in &topic.matching_session_ids {
                if let Some((title, date)) = session_map.get(matching_id) {
                    let _ = database.link_topic_to_session(&topic.id, matching_id, title, date);
                }
            }
        }

        // Upsert blockers
        for blocker in &analysis.blockers {
            let matching_dates: Vec<&str> = blocker
                .matching_session_ids
                .iter()
                .filter_map(|id| session_map.get(id).map(|(_, date)| *date))
                .collect();
            let first_mentioned = matching_dates
                .iter()
                .min()
                .copied()
                .unwrap_or(session_date);

            let occurrence_count = (blocker.matching_session_ids.len() as i64 + 1).max(1);

            database
                .upsert_insight_blocker(
                    &blocker.id,
                    &blocker.description,
                    first_mentioned,
                    session_date,
                    occurrence_count,
                    blocker.resolved,
                )
                .map_err(|e| e.to_string())?;

            database
                .link_blocker_to_session(
                    &blocker.id,
                    session_id,
                    &new_session.title,
                    session_date,
                )
                .map_err(|e| e.to_string())?;

            for matching_id in &blocker.matching_session_ids {
                if let Some((title, date)) = session_map.get(matching_id) {
                    let _ =
                        database.link_blocker_to_session(&blocker.id, matching_id, title, date);
                }
            }
        }

        Ok(())
    }
}
