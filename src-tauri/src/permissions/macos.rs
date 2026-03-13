use super::{PermissionDiagnostics, PermissionSnapshot};
use crate::audio::{microphone_permission_status, screen_recording_permission_status};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

fn accessibility_status() -> &'static str {
    #[allow(unsafe_code)]
    unsafe {
        if AXIsProcessTrusted() {
            "granted"
        } else {
            "denied"
        }
    }
}

pub fn permission_snapshot() -> PermissionSnapshot {
    PermissionSnapshot {
        screen_recording: screen_recording_permission_status(),
        microphone: microphone_permission_status(),
        accessibility: accessibility_status(),
    }
}

pub fn permission_diagnostics() -> PermissionDiagnostics {
    PermissionDiagnostics {
        screen_recording_detection_ready: true,
        microphone_detection_ready: true,
        accessibility_detection_ready: true,
    }
}
