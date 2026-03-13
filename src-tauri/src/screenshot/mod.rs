use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Default)]
pub struct ScreenshotStore;

impl ScreenshotStore {
    pub fn new() -> Self {
        Self
    }

    pub fn artifacts_dir(&self, app_dir: &Path, session_id: &str) -> PathBuf {
        app_dir
            .join("artifacts")
            .join("screenshots")
            .join(session_id)
    }

    pub fn persist_bytes(
        &self,
        app_dir: &Path,
        session_id: &str,
        artifact_name: &str,
        extension: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, String> {
        let artifacts_dir = self.artifacts_dir(app_dir, session_id);
        fs::create_dir_all(&artifacts_dir).map_err(|error| error.to_string())?;
        let storage_path = artifacts_dir.join(format!("{artifact_name}.{extension}"));
        fs::write(&storage_path, bytes).map_err(|error| error.to_string())?;
        Ok(storage_path)
    }

    pub fn delete_if_exists(&self, path: &Path) -> Result<(), String> {
        match fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}
