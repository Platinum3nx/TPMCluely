use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowRuntimeSnapshot {
    pub overlay_open: bool,
    pub last_changed_at: Option<String>,
}

#[derive(Debug, Default)]
struct WindowControllerState {
    overlay_open: bool,
    last_changed_at: Option<String>,
}

#[derive(Clone, Default)]
pub struct WindowController {
    inner: Arc<Mutex<WindowControllerState>>,
}

impl WindowController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_ready(&self) -> bool {
        self.inner.lock().is_ok()
    }

    pub fn set_overlay_open(&self, open: bool) -> WindowRuntimeSnapshot {
        match self.inner.lock() {
            Ok(mut inner) => {
                inner.overlay_open = open;
                inner.last_changed_at = Some(Utc::now().to_rfc3339());
                WindowRuntimeSnapshot {
                    overlay_open: inner.overlay_open,
                    last_changed_at: inner.last_changed_at.clone(),
                }
            }
            Err(_) => WindowRuntimeSnapshot::default(),
        }
    }

    pub fn snapshot(&self) -> WindowRuntimeSnapshot {
        match self.inner.lock() {
            Ok(inner) => WindowRuntimeSnapshot {
                overlay_open: inner.overlay_open,
                last_changed_at: inner.last_changed_at.clone(),
            },
            Err(_) => WindowRuntimeSnapshot::default(),
        }
    }
}
