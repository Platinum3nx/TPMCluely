use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;

extern "C" {
    fn tpm_set_window_sharing_none(ns_window: *mut std::ffi::c_void);
    fn tpm_set_window_sharing_readwrite(ns_window: *mut std::ffi::c_void);
}

/// Exclude a Tauri window from all macOS screen capture, screen sharing,
/// and screen recording APIs (Zoom, Meet, Teams, OBS, QuickTime, etc.).
/// Requires macOS 12.0+. The window remains visible on the local display.
#[cfg(target_os = "macos")]
pub fn set_stealth_enabled(window: &tauri::WebviewWindow, enabled: bool) {
    if let Ok(ns_window) = window.ns_window() {
        unsafe {
            if enabled {
                tpm_set_window_sharing_none(ns_window as *mut _);
            } else {
                tpm_set_window_sharing_readwrite(ns_window as *mut _);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_stealth_enabled(_window: &tauri::WebviewWindow, _enabled: bool) {}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowRuntimeSnapshot {
    pub overlay_open: bool,
    pub stealth_active: bool,
    pub last_changed_at: Option<String>,
}

#[derive(Debug, Default)]
struct WindowControllerState {
    overlay_open: bool,
    stealth_active: bool,
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
                    stealth_active: inner.stealth_active,
                    last_changed_at: inner.last_changed_at.clone(),
                }
            }
            Err(_) => WindowRuntimeSnapshot::default(),
        }
    }

    pub fn set_stealth_active(&self, active: bool) -> WindowRuntimeSnapshot {
        match self.inner.lock() {
            Ok(mut inner) => {
                inner.stealth_active = active;
                inner.last_changed_at = Some(Utc::now().to_rfc3339());
                WindowRuntimeSnapshot {
                    overlay_open: inner.overlay_open,
                    stealth_active: inner.stealth_active,
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
                stealth_active: inner.stealth_active,
                last_changed_at: inner.last_changed_at.clone(),
            },
            Err(_) => WindowRuntimeSnapshot::default(),
        }
    }
}
