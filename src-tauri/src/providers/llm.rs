use std::env;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::time::sleep;

const DEFAULT_MODEL: &str = "gemini-2.5-flash";
const DEFAULT_EMBEDDING_MODEL: &str = "gemini-embedding-001";
const DEFAULT_EMBEDDING_DIMENSIONS: u32 = 768;
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
    #[error("llm provider response did not include an embedding")]
    MissingEmbedding,
    #[error("llm provider stream payload was invalid: {0}")]
    MalformedStreamPayload(String),
    #[error("llm provider stream interrupted: {0}")]
    StreamInterrupted(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmPart {
    Text(String),
    InlineImage {
        mime_type: String,
        data_base64: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LlmGenerationOptions {
    pub response_mime_type: Option<String>,
    pub max_output_tokens: Option<u32>,
    pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingTaskType {
    RetrievalDocument,
    RetrievalQuery,
}

impl EmbeddingTaskType {
    fn as_str(self) -> &'static str {
        match self {
            Self::RetrievalDocument => "RETRIEVAL_DOCUMENT",
            Self::RetrievalQuery => "RETRIEVAL_QUERY",
        }
    }
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

fn gemini_stream_generate_content_endpoint(api_key: &str) -> String {
    format!(
        "{}/models/{DEFAULT_MODEL}:streamGenerateContent?alt=sse&key={api_key}",
        gemini_base_url().trim_end_matches('/')
    )
}

fn gemini_embed_content_endpoint(api_key: &str) -> String {
    format!(
        "{}/models/{DEFAULT_EMBEDDING_MODEL}:embedContent?key={api_key}",
        gemini_base_url().trim_end_matches('/')
    )
}

fn extract_response_text(value: &serde_json::Value) -> String {
    value
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
        .to_string()
}

pub fn extract_function_call(value: &serde_json::Value) -> Option<(String, serde_json::Value)> {
    let part = value
        .get("candidates")?
        .as_array()?
        .first()?
        .get("content")?
        .get("parts")?
        .as_array()?
        .first()?;
        
    let call = part.get("functionCall")?;
    let name = call.get("name")?.as_str()?.to_string();
    let args = call.get("args")?.clone();
    
    Some((name, args))
}

fn extract_embedding_values(value: &serde_json::Value) -> Option<Vec<f32>> {
    value
        .get("embedding")
        .and_then(|embedding| embedding.get("values"))
        .and_then(|values| values.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_f64().map(|item| item as f32))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
}

async fn request_with_retry(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
    options: &LlmGenerationOptions,
) -> Result<String, LlmProviderError> {
    let endpoint = gemini_generate_content_endpoint(api_key);

    let mut last_error = None;
    for attempt in 0..3 {
        let response = client
            .post(&endpoint)
            .json(&build_request_payload(system_prompt, user_parts, options))
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
        let text = extract_response_text(&value);

        if !text.is_empty() {
            return Ok(text);
        }

        last_error = Some(LlmProviderError::MissingText);
    }

    Err(last_error.unwrap_or(LlmProviderError::MissingText))
}

async fn stream_request_with_retry<F>(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
    options: &LlmGenerationOptions,
    mut on_delta: F,
) -> Result<String, LlmProviderError>
where
    F: FnMut(&str),
{
    let endpoint = gemini_stream_generate_content_endpoint(api_key);
    let mut last_error = None;

    'attempts: for attempt in 0..3 {
        let response = client
            .post(&endpoint)
            .json(&build_request_payload(system_prompt, user_parts, options))
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

        let mut emitted_any = false;
        let mut accumulated_text = String::new();
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();

        while let Some(next_chunk) = stream.next().await {
            let chunk = match next_chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    if !emitted_any && attempt < 2 {
                        sleep(Duration::from_millis((attempt + 1) as u64 * 400)).await;
                        continue 'attempts;
                    }
                    return Err(LlmProviderError::StreamInterrupted(error.to_string()));
                }
            };

            buffer.push_str(String::from_utf8_lossy(&chunk).as_ref());

            while let Some(line_break) = buffer.find('\n') {
                let mut line = buffer.drain(..=line_break).collect::<String>();
                if line.ends_with('\n') {
                    line.pop();
                }
                if line.ends_with('\r') {
                    line.pop();
                }

                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = data.trim();
                if payload.is_empty() || payload == "[DONE]" {
                    continue;
                }

                let value: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(value) => value,
                    Err(error) => {
                        if !emitted_any && attempt < 2 {
                            sleep(Duration::from_millis((attempt + 1) as u64 * 400)).await;
                            continue 'attempts;
                        }
                        return Err(LlmProviderError::MalformedStreamPayload(error.to_string()));
                    }
                };

                let current_text = extract_response_text(&value);
                if current_text.is_empty() {
                    continue;
                }

                let delta = if current_text.starts_with(&accumulated_text) {
                    current_text[accumulated_text.len()..].to_string()
                } else {
                    current_text.clone()
                };

                accumulated_text = current_text;
                if delta.is_empty() {
                    continue;
                }

                emitted_any = true;
                on_delta(&delta);
            }
        }

        let text = accumulated_text.trim().to_string();
        if !text.is_empty() {
            return Ok(text);
        }

        last_error = Some(LlmProviderError::MissingText);
    }

    Err(last_error.unwrap_or(LlmProviderError::MissingText))
}

async fn embedding_request_with_retry(
    client: &Client,
    api_key: &str,
    text: &str,
    task_type: EmbeddingTaskType,
) -> Result<Vec<f32>, LlmProviderError> {
    let endpoint = gemini_embed_content_endpoint(api_key);
    let payload = json!({
        "model": DEFAULT_EMBEDDING_MODEL,
        "content": {
            "parts": [{ "text": text }]
        },
        "taskType": task_type.as_str(),
        "outputDimensionality": DEFAULT_EMBEDDING_DIMENSIONS,
    });

    let mut last_error = None;
    for attempt in 0..3 {
        let response = client.post(&endpoint).json(&payload).send().await?;
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
        if let Some(embedding) = extract_embedding_values(&value) {
            return Ok(embedding);
        }

        last_error = Some(LlmProviderError::MissingEmbedding);
    }

    Err(last_error.unwrap_or(LlmProviderError::MissingEmbedding))
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
    options: &LlmGenerationOptions,
) -> serde_json::Value {
    let mut generation_config = json!({
        "temperature": 0.2
    });
    if let Some(mime_type) = options.response_mime_type.as_deref() {
        generation_config["responseMimeType"] = json!(mime_type);
    }
    if let Some(max_output_tokens) = options.max_output_tokens {
        generation_config["maxOutputTokens"] = json!(max_output_tokens);
    }

    let mut payload = json!({
        "systemInstruction": {
            "parts": [{ "text": system_prompt }]
        },
        "contents": [{
            "role": "user",
            "parts": build_user_parts(user_parts)
        }],
        "generationConfig": generation_config
    });

    if let Some(tools) = &options.tools {
        payload["tools"] = json!([tools]);
    }

    payload
}

pub async fn generate_text(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, LlmProviderError> {
    generate_text_with_options(
        api_key,
        system_prompt,
        user_prompt,
        &LlmGenerationOptions::default(),
    )
    .await
}

pub async fn generate_text_with_options(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    options: &LlmGenerationOptions,
) -> Result<String, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    request_with_retry(&client, api_key, system_prompt, &[LlmPart::Text(user_prompt.to_string())], options).await
}

pub async fn check_for_tool_call(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    options: &LlmGenerationOptions,
) -> Result<Option<(String, serde_json::Value)>, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;
        
    let endpoint = gemini_generate_content_endpoint(api_key);
    let response = client
        .post(&endpoint)
        .json(&build_request_payload(system_prompt, &[LlmPart::Text(user_prompt.to_string())], options))
        .send()
        .await?;
        
    let status = response.status();
    if !status.is_success() {
         return Err(LlmProviderError::HttpStatus(status.as_u16(), response.text().await.unwrap_or_default()));
    }
    
    let value: serde_json::Value = response.json().await?;
    Ok(extract_function_call(&value))
}

pub async fn generate_text_multimodal(
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
) -> Result<String, LlmProviderError> {
    generate_text_multimodal_with_options(
        api_key,
        system_prompt,
        user_parts,
        &LlmGenerationOptions::default(),
    )
    .await
}

pub async fn generate_text_multimodal_with_options(
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
    options: &LlmGenerationOptions,
) -> Result<String, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    request_with_retry(&client, api_key, system_prompt, user_parts, options).await
}

pub async fn stream_text_multimodal_with_options<F>(
    api_key: &str,
    system_prompt: &str,
    user_parts: &[LlmPart],
    options: &LlmGenerationOptions,
    on_delta: F,
) -> Result<String, LlmProviderError>
where
    F: FnMut(&str),
{
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    stream_request_with_retry(&client, api_key, system_prompt, user_parts, options, on_delta).await
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
        &LlmGenerationOptions {
            response_mime_type: Some("application/json".to_string()),
            max_output_tokens: None,
            tools: None,
        },
    )
    .await
}

pub async fn generate_embedding(
    api_key: &str,
    text: &str,
    task_type: EmbeddingTaskType,
) -> Result<Vec<f32>, LlmProviderError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()?;

    embedding_request_with_retry(&client, api_key, text, task_type).await
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;

    use super::{
        build_request_payload, generate_embedding, generate_text, generate_text_with_options,
        stream_text_multimodal_with_options, EmbeddingTaskType, LlmGenerationOptions, LlmPart,
    };

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
            &LlmGenerationOptions::default(),
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
            &LlmGenerationOptions {
                response_mime_type: Some("application/json".to_string()),
                max_output_tokens: None,
            },
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

    #[tokio::test]
    async fn generate_text_with_options_includes_max_output_tokens() {
        let _guard = env_lock().lock().expect("env lock should hold");
        let (base_url, request, handle) = spawn_http_json_server(
            r#"{"candidates":[{"content":{"parts":[{"text":"Stub answer"}]}}]}"#,
        );
        unsafe {
            std::env::set_var("TPMCLUELY_GEMINI_BASE_URL", &base_url);
        }

        let result = generate_text_with_options(
            "test-key",
            "system prompt",
            "What happened?",
            &LlmGenerationOptions {
                response_mime_type: None,
                max_output_tokens: Some(160),
            },
        )
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
        assert!(captured_request.contains("\"maxOutputTokens\":160"));
    }

    fn spawn_http_sse_server(
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
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });

        (format!("http://{address}/v1beta"), request, handle)
    }

    #[tokio::test]
    async fn stream_text_multimodal_uses_streaming_endpoint_and_collects_chunks() {
        let _guard = env_lock().lock().expect("env lock should hold");
        let (base_url, request, handle) = spawn_http_sse_server(
            concat!(
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello world\"}]}}]}\n\n"
            ),
        );
        unsafe {
            std::env::set_var("TPMCLUELY_GEMINI_BASE_URL", &base_url);
        }

        let mut streamed = String::new();
        let result = stream_text_multimodal_with_options(
            "test-key",
            "system prompt",
            &[LlmPart::Text("What happened?".to_string())],
            &LlmGenerationOptions {
                response_mime_type: None,
                max_output_tokens: Some(160),
            },
            |delta| streamed.push_str(delta),
        )
        .await
        .expect("stream request should succeed");

        unsafe {
            std::env::remove_var("TPMCLUELY_GEMINI_BASE_URL");
        }
        handle.join().expect("server should finish");

        let captured_request = request
            .lock()
            .expect("request lock should hold")
            .clone()
            .expect("request should be captured");
        assert_eq!(streamed, "Hello world");
        assert_eq!(result, "Hello world");
        assert!(captured_request.starts_with(
            "POST /v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=test-key HTTP/1.1"
        ));
    }

    #[tokio::test]
    async fn generate_embedding_uses_embedding_endpoint_and_task_type() {
        let _guard = env_lock().lock().expect("env lock should hold");
        let (base_url, request, handle) =
            spawn_http_json_server(r#"{"embedding":{"values":[0.1,0.2,0.3]}}"#);
        unsafe {
            std::env::set_var("TPMCLUELY_GEMINI_BASE_URL", &base_url);
        }

        let embedding = generate_embedding(
            "test-key",
            "Find the rollout owner",
            EmbeddingTaskType::RetrievalQuery,
        )
        .await
        .expect("embedding request should succeed");

        unsafe {
            std::env::remove_var("TPMCLUELY_GEMINI_BASE_URL");
        }
        handle.join().expect("server should finish");

        let captured_request = request
            .lock()
            .expect("request lock should hold")
            .clone()
            .expect("request should be captured");
        assert_eq!(embedding, vec![0.1_f32, 0.2_f32, 0.3_f32]);
        assert!(captured_request.starts_with(
            "POST /v1beta/models/gemini-embedding-001:embedContent?key=test-key HTTP/1.1"
        ));
        assert!(captured_request.contains("\"taskType\":\"RETRIEVAL_QUERY\""));
        assert!(captured_request.contains("\"outputDimensionality\":768"));
    }
}

pub async fn check_connectivity(api_key: &str) -> Result<(), LlmProviderError> {
    let _ = generate_text(api_key, "You are a connectivity probe.", "Reply with OK.").await?;
    Ok(())
}
