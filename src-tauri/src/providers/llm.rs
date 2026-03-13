use std::env;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmPart {
    Text(String),
    InlineImage {
        mime_type: String,
        data_base64: String,
    },
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

const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

fn gemini_base_url() -> String {
    env::var("TPMCLUELY_GEMINI_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_GEMINI_BASE_URL.to_string())
}

fn gemini_generate_content_endpoint(api_key: &str) -> String {
    format!(
        "{}/models/{DEFAULT_MODEL}:generateContent?key={api_key}",
        gemini_base_url().trim_end_matches('/')
    )
}

async fn request_with_retry(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
    response_mime_type: Option<&str>,
) -> Result<String, LlmProviderError> {
    let endpoint = gemini_generate_content_endpoint(api_key);

    let mut last_error = None;
    for attempt in 0..3 {
        let response = client
            .post(&endpoint)
            .json(&build_request_payload(
                system_prompt,
                user_parts,
                response_mime_type,
            ))
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

fn build_user_parts(user_parts: &[LlmPart]) -> Vec<serde_json::Value> {
    user_parts
        .iter()
        .map(|part| match part {
            LlmPart::Text(text) => json!({ "text": text }),
            LlmPart::InlineImage {
                mime_type,
                data_base64,
            } => json!({
                "inline_data": {
                    "mime_type": mime_type,
                    "data": data_base64
                }
            }),
        })
        .collect()
}

fn build_request_payload(
    system_prompt: &str,
    user_parts: &[LlmPart],
    response_mime_type: Option<&str>,
) -> serde_json::Value {
    let mut generation_config = json!({
        "temperature": 0.2
    });
    if let Some(mime_type) = response_mime_type {
        generation_config["responseMimeType"] = json!(mime_type);
    }

    json!({
        "systemInstruction": {
            "parts": [{ "text": system_prompt }]
        },
        "contents": [{
            "role": "user",
            "parts": build_user_parts(user_parts)
        }],
        "generationConfig": generation_config
    })
}

pub async fn generate_text(
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
        &[LlmPart::Text(user_prompt.to_string())],
        None,
    )
    .await
}

pub async fn generate_text_multimodal(
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
) -> Result<String, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    request_with_retry(&client, api_key, system_prompt, user_parts, None).await
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
        &[LlmPart::Text(user_prompt.to_string())],
        Some("application/json"),
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;

    use super::{build_request_payload, generate_text, LlmPart};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        let mut header_end = None;
        let mut content_length = 0usize;

        loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);

            if header_end.is_none() {
                if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = Some(index + 4);
                    let headers = String::from_utf8_lossy(&buffer[..index + 4]);
                    for line in headers.lines() {
                        if let Some((name, value)) = line.split_once(':') {
                            if name.eq_ignore_ascii_case("Content-Length") {
                                content_length = value.trim().parse::<usize>().unwrap_or(0);
                            }
                        }
                    }
                }
            }

            if let Some(index) = header_end {
                if buffer.len() >= index + content_length {
                    break;
                }
            }
        }

        String::from_utf8(buffer).expect("request should be utf8")
    }

    fn spawn_http_json_server(
        response_body: &'static str,
    ) -> (String, Arc<Mutex<Option<String>>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("listener should have address");
        let request = Arc::new(Mutex::new(None));
        let request_clone = Arc::clone(&request);

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connection should arrive");
            let captured_request = read_http_request(&mut stream);
            *request_clone.lock().expect("request lock should hold") = Some(captured_request);

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });

        (format!("http://{address}/v1beta"), request, handle)
    }

    #[test]
    fn builds_multimodal_payload_with_inline_image_parts() {
        let payload = build_request_payload(
            "system",
            &[
                LlmPart::Text("question".to_string()),
                LlmPart::InlineImage {
                    mime_type: "image/jpeg".to_string(),
                    data_base64: "abc123".to_string(),
                },
            ],
            None,
        );

        let parts = payload["contents"][0]["parts"]
            .as_array()
            .expect("parts should be an array");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0]["text"], "question");
        assert_eq!(parts[1]["inline_data"]["mime_type"], "image/jpeg");
        assert_eq!(parts[1]["inline_data"]["data"], "abc123");
    }

    #[test]
    fn builds_json_payload_without_inline_image_when_text_only() {
        let payload = build_request_payload(
            "system",
            &[LlmPart::Text("tickets".to_string())],
            Some("application/json"),
        );

        let parts = payload["contents"][0]["parts"]
            .as_array()
            .expect("parts should be an array");
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["text"], "tickets");
        assert!(parts[0].get("inline_data").is_none());
        assert_eq!(
            payload["generationConfig"]["responseMimeType"],
            "application/json"
        );
    }

    #[tokio::test]
    async fn generate_text_uses_base_url_override_against_stub_server() {
        let _guard = env_lock().lock().expect("env lock should hold");
        let (base_url, request, handle) = spawn_http_json_server(
            r#"{"candidates":[{"content":{"parts":[{"text":"Stub answer"}]}}]}"#,
        );
        unsafe {
            std::env::set_var("TPMCLUELY_GEMINI_BASE_URL", &base_url);
        }

        let result = generate_text("test-key", "system prompt", "What happened?")
            .await
            .expect("stub request should succeed");

        unsafe {
            std::env::remove_var("TPMCLUELY_GEMINI_BASE_URL");
        }
        handle.join().expect("server should finish");

        let captured_request = request
            .lock()
            .expect("request lock should hold")
            .clone()
            .expect("request should be captured");
        assert_eq!(result, "Stub answer");
        assert!(captured_request.starts_with(
            "POST /v1beta/models/gemini-2.5-flash:generateContent?key=test-key HTTP/1.1"
        ));
        assert!(captured_request.contains("\"systemInstruction\""));
        assert!(captured_request.contains("\"What happened?\""));
    }
}

pub async fn check_connectivity(api_key: &str) -> Result<(), LlmProviderError> {
    let _ = generate_text(api_key, "You are a connectivity probe.", "Reply with OK.").await?;
    Ok(())
}
