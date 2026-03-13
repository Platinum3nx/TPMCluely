use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;

use crate::session::state_machine::SessionStatus;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeSnapshot {
    pub active_session_id: Option<String>,
    pub active_status: Option<String>,
    pub last_transition_at: Option<String>,
}

#[derive(Debug, Default)]
struct SessionManagerState {
    active_session_id: Option<String>,
    active_status: Option<String>,
    last_transition_at: Option<String>,
}

#[derive(Clone, Default)]
pub struct SessionManager {
    inner: Arc<Mutex<SessionManagerState>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_ready(&self) -> bool {
        self.inner.lock().is_ok()
    }

    pub fn restore(&self, session_id: Option<String>, status: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.active_session_id = session_id;
            inner.active_status = status;
            inner.last_transition_at = Some(Utc::now().to_rfc3339());
        }
    }

    pub fn mark_active(&self, session_id: &str, status: SessionStatus) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.active_session_id = Some(session_id.to_string());
            inner.active_status = Some(format!("{status:?}").to_lowercase());
            inner.last_transition_at = Some(Utc::now().to_rfc3339());
        }
    }

    pub fn mark_status(&self, session_id: &str, status: SessionStatus) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.active_session_id.as_deref() == Some(session_id) {
                inner.active_status = Some(format!("{status:?}").to_lowercase());
                inner.last_transition_at = Some(Utc::now().to_rfc3339());
            }
        }
    }

    pub fn clear(&self, session_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.active_session_id.as_deref() == Some(session_id) {
                inner.active_session_id = None;
                inner.active_status = Some(SessionStatus::Completed.as_str().to_string());
                inner.last_transition_at = Some(Utc::now().to_rfc3339());
            }
        }
    }

    pub fn snapshot(&self) -> SessionRuntimeSnapshot {
        match self.inner.lock() {
            Ok(inner) => SessionRuntimeSnapshot {
                active_session_id: inner.active_session_id.clone(),
                active_status: inner.active_status.clone(),
                last_transition_at: inner.last_transition_at.clone(),
            },
            Err(_) => SessionRuntimeSnapshot::default(),
        }
    }
}

impl SessionStatus {
    fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Preparing => "preparing",
            SessionStatus::Active => "active",
            SessionStatus::Paused => "paused",
            SessionStatus::Finishing => "finishing",
            SessionStatus::Completed => "completed",
            SessionStatus::PermissionBlocked => "permission_blocked",
            SessionStatus::CaptureError => "capture_error",
            SessionStatus::ProviderDegraded => "provider_degraded",
            SessionStatus::FinalizationFailed => "finalization_failed",
        }
    }
}
