use keyring::Entry;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct SecretPresence {
    pub gemini_configured: bool,
    pub deepgram_configured: bool,
    pub linear_configured: bool,
}

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("keyring error: {0}")]
    Keyring(String),
}

pub trait AppSecretStore: Send + Sync {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), SecretError>;
    fn read_secret(&self, key: &str) -> Result<Option<String>, SecretError>;

    fn presence(&self) -> Result<SecretPresence, SecretError> {
        let gemini = self.read_secret("gemini_api_key")?.is_some();
        let deepgram = self.read_secret("deepgram_api_key")?.is_some();
        let linear_key = self.read_secret("linear_api_key")?.is_some();
        let linear_team = self.read_secret("linear_team_id")?.is_some();

        Ok(SecretPresence {
            gemini_configured: gemini,
            deepgram_configured: deepgram,
            linear_configured: linear_key && linear_team,
        })
    }
}

#[derive(Clone)]
pub struct KeychainSecretStore {
    service_name: String,
}

impl KeychainSecretStore {
    pub fn new(service_name: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
        }
    }

    fn entry(&self, key: &str) -> Result<Entry, SecretError> {
        Entry::new(&self.service_name, key).map_err(|error| SecretError::Keyring(error.to_string()))
    }
}

impl AppSecretStore for KeychainSecretStore {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), SecretError> {
        self.entry(key)?
            .set_password(value)
            .map_err(|error| SecretError::Keyring(error.to_string()))
    }

    fn read_secret(&self, key: &str) -> Result<Option<String>, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(error) => {
                let message = error.to_string();
                if message.contains("NoEntry") || message.contains("not found") {
                    Ok(None)
                } else {
                    Err(SecretError::Keyring(message))
                }
            }
        }
    }
}
