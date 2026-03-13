pub mod buffering;
pub mod capture;

use serde::Serialize;

pub use capture::{
    microphone_permission_status, screen_recording_permission_status, CaptureCapabilities,
    CaptureHealthPayload, CaptureRuntimeState, CaptureService, CaptureStatePayload,
    StartSystemAudioCaptureInput, SystemAudioSource, SystemAudioSourceKind,
    SystemAudioSourceListPayload, EVENT_CAPTURE_HEALTH, EVENT_CAPTURE_PARTIAL,
    EVENT_CAPTURE_SEGMENT, EVENT_CAPTURE_STATE,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRuntimeDiagnostics {
    pub capture_backend: &'static str,
}

#[derive(Clone, Default)]
pub struct AudioRuntime {
    service: CaptureService,
}

impl AudioRuntime {
    pub fn new() -> Self {
        Self {
            service: CaptureService::new(),
        }
    }

    pub fn diagnostics(&self) -> AudioRuntimeDiagnostics {
        AudioRuntimeDiagnostics {
            capture_backend: if cfg!(target_os = "macos") {
                "screen_capture_kit"
            } else {
                "unsupported"
            },
        }
    }

    pub fn capture(&self) -> &CaptureService {
        &self.service
    }
}

pub fn module_ready() -> bool {
    cfg!(target_os = "macos")
}
