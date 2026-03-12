use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLifecycleEvent {
    pub event_type: String,
    pub detail: String,
}
