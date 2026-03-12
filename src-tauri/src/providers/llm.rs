use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub prompt: String,
    pub context: String,
}

pub trait LlmProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}
