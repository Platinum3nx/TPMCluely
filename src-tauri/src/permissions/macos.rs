use super::PermissionSnapshot;

pub fn permission_snapshot() -> PermissionSnapshot {
    PermissionSnapshot {
        screen_recording: "unknown",
        microphone: "unknown",
        accessibility: "unknown",
    }
}
