mod macos;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSnapshot {
    pub screen_recording: &'static str,
    pub microphone: &'static str,
    pub accessibility: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDiagnostics {
    pub screen_recording_detection_ready: bool,
    pub microphone_detection_ready: bool,
    pub accessibility_detection_ready: bool,
}

#[derive(Clone, Default)]
pub struct PermissionService;

impl PermissionService {
    pub fn new() -> Self {
        Self
    }

    pub fn snapshot(&self) -> PermissionSnapshot {
        macos::permission_snapshot()
    }

    pub fn diagnostics(&self) -> PermissionDiagnostics {
        macos::permission_diagnostics()
    }
}
