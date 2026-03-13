use std::env;

use http::Request;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_tungstenite::connect_async;

const DEFAULT_DEEPGRAM_WS_URL: &str = "wss://api.deepgram.com/v1/listen";
const DEEPGRAM_QUERY: &str = "encoding=linear16&channels=1&sample_rate=16000&punctuate=true&smart_format=true&interim_results=true&model=nova-3&endpointing=300&utterance_end_ms=1000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    pub session_id: String,
    pub audio_language: String,
}

pub trait SpeechToTextProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}

#[derive(Debug, Error)]
pub enum SttProviderError {
    #[error("http error: {0}")]
    Http(#[from] http::Error),
    #[error("websocket error: {0}")]
    Websocket(#[from] tokio_tungstenite::tungstenite::Error),
}

pub fn deepgram_listen_endpoint(audio_language: &str) -> String {
    let mut endpoint = env::var("TPMCLUELY_DEEPGRAM_WS_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DEEPGRAM_WS_URL.to_string());

    if endpoint.contains('?') {
        endpoint.push('&');
    } else {
        endpoint.push('?');
    }
    endpoint.push_str(DEEPGRAM_QUERY);

    match audio_language {
        "" | "auto" => {}
        "en" => endpoint.push_str("&language=en-US"),
        "es" => endpoint.push_str("&language=es"),
        "fr" => endpoint.push_str("&language=fr"),
        other => {
            endpoint.push_str("&language=");
            endpoint.push_str(other);
        }
    }

    endpoint
}

pub async fn check_connectivity(
    api_key: &str,
    audio_language: &str,
) -> Result<(), SttProviderError> {
    let request = Request::builder()
        .uri(deepgram_listen_endpoint(audio_language))
        .header("Authorization", format!("Token {api_key}"))
        .body(())?;

    let (mut socket, _) = connect_async(request).await?;
    socket.close(None).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, OnceLock};

    use super::deepgram_listen_endpoint;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn deepgram_endpoint_honors_base_url_override_and_language_mapping() {
        let _guard = env_lock().lock().expect("env lock should hold");
        unsafe {
            std::env::set_var("TPMCLUELY_DEEPGRAM_WS_URL", "ws://127.0.0.1:9001/listen");
        }

        let endpoint = deepgram_listen_endpoint("en");

        unsafe {
            std::env::remove_var("TPMCLUELY_DEEPGRAM_WS_URL");
        }

        assert!(endpoint.starts_with("ws://127.0.0.1:9001/listen?"));
        assert!(endpoint.contains("model=nova-3"));
        assert!(endpoint.contains("language=en-US"));
    }
}
