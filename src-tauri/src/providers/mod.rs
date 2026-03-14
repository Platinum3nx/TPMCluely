pub mod linear;
pub mod llm;
pub mod stt;

use serde::Serialize;

use crate::secrets::SecretPresence;

#[derive(Clone, Default)]
pub struct ProviderCatalog;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub llm_provider: &'static str,
    pub stt_provider: &'static str,
    pub ticket_provider: &'static str,
    pub embedding_provider: &'static str,
    pub llm_ready: bool,
    pub stt_ready: bool,
    pub linear_ready: bool,
    pub embedding_ready: bool,
}

impl ProviderCatalog {
    pub fn snapshot(&self, presence: &SecretPresence) -> ProviderSnapshot {
        ProviderSnapshot {
            llm_provider: "Gemini",
            stt_provider: "Deepgram",
            ticket_provider: "Gemini + Linear",
            embedding_provider: "Gemini Embeddings",
            llm_ready: presence.gemini_configured,
            stt_ready: presence.deepgram_configured,
            linear_ready: presence.linear_configured,
            embedding_ready: presence.gemini_configured,
        }
    }
}
