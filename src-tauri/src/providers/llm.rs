use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::time::sleep;

const DEFAULT_MODEL: &str = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_SECS: u64 = 25;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub prompt: String,
    pub context: String,
}

pub trait LlmProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}

#[derive(Debug, Error)]
pub enum LlmProviderError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("llm provider returned {0}: {1}")]
    HttpStatus(u16, String),
    #[error("llm provider response did not include text")]
    MissingText,
}

fn should_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

async fn request_with_retry(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    response_mime_type: Option<&str>,
) -> Result<String, LlmProviderError> {
    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{DEFAULT_MODEL}:generateContent?key={api_key}"
    );

    let mut last_error = None;
    for attempt in 0..3 {
        let mut generation_config = json!({
            "temperature": 0.2
        });
        if let Some(mime_type) = response_mime_type {
            generation_config["responseMimeType"] = json!(mime_type);
        }

        let response = client
            .post(&endpoint)
            .json(&json!({
                "systemInstruction": {
                    "parts": [{ "text": system_prompt }]
                },
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": user_prompt }]
                }],
                "generationConfig": generation_config
            }))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            if should_retry(status) && attempt < 2 {
                sleep(Duration::from_millis((attempt + 1) as u64 * 400)).await;
                continue;
            }

            let message = if body.trim().is_empty() {
                status.to_string()
            } else {
                body.chars().take(240).collect()
            };
            return Err(LlmProviderError::HttpStatus(status.as_u16(), message));
        }

        let value: serde_json::Value = response.json().await?;
        let text = value
            .get("candidates")
            .and_then(|candidates| candidates.as_array())
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(|parts| parts.as_array())
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
            .trim()
            .to_string();

        if !text.is_empty() {
            return Ok(text);
        }

        last_error = Some(LlmProviderError::MissingText);
    }

    Err(last_error.unwrap_or(LlmProviderError::MissingText))
}

pub async fn generate_text(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    request_with_retry(&client, api_key, system_prompt, user_prompt, None).await
}

pub async fn generate_json(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    request_with_retry(
        &client,
        api_key,
        system_prompt,
        user_prompt,
        Some("application/json"),
    )
    .await
}
