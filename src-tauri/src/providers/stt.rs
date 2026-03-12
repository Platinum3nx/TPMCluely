use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    pub session_id: String,
    pub audio_language: String,
}

pub trait SpeechToTextProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}
