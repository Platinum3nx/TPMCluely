use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueRequest {
    pub title: String,
    pub description: String,
}

pub trait LinearProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
}
