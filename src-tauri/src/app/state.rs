use std::path::PathBuf;
use std::sync::Arc;

use crate::db::AppDatabase;
use crate::permissions::PermissionService;
use crate::providers::ProviderCatalog;
use crate::secrets::{AppSecretStore, KeychainSecretStore};

#[derive(Clone)]
pub struct AppState {
    database: Arc<AppDatabase>,
    secret_store: Arc<dyn AppSecretStore>,
    permissions: PermissionService,
    providers: ProviderCatalog,
}

impl AppState {
    pub fn initialize(app_dir: PathBuf) -> Result<Self, String> {
        let database = AppDatabase::open(app_dir.join("cluely-desktop.db"))
            .map_err(|error| error.to_string())?;
        let secret_store = KeychainSecretStore::new("com.cluely.desktop");

        Ok(Self {
            database: Arc::new(database),
            secret_store: Arc::new(secret_store),
            permissions: PermissionService::new(),
            providers: ProviderCatalog,
        })
    }

    pub fn database(&self) -> Arc<AppDatabase> {
        Arc::clone(&self.database)
    }

    pub fn secret_store(&self) -> Arc<dyn AppSecretStore> {
        Arc::clone(&self.secret_store)
    }

    pub fn permissions(&self) -> &PermissionService {
        &self.permissions
    }

    pub fn providers(&self) -> &ProviderCatalog {
        &self.providers
    }
}
