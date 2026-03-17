use std::path::PathBuf;
use std::sync::Arc;

use crate::audio::AudioRuntime;
use crate::db::AppDatabase;
use crate::insights::InsightsEngine;
use crate::permissions::PermissionService;
use crate::providers::ProviderCatalog;
use crate::repo_search::RepoSearchRuntime;
use crate::search::SearchRuntime;
use crate::secrets::{AppSecretStore, KeychainSecretStore};
use crate::session::manager::SessionManager;
use crate::window::WindowController;

#[derive(Clone)]
pub struct AppState {
    app_dir: Arc<PathBuf>,
    database: Arc<AppDatabase>,
    secret_store: Arc<dyn AppSecretStore>,
    permissions: PermissionService,
    providers: ProviderCatalog,
    search_runtime: SearchRuntime,
    repo_search_runtime: RepoSearchRuntime,
    audio_runtime: AudioRuntime,
    session_manager: SessionManager,
    window_controller: WindowController,
    insights_engine: InsightsEngine,
}

impl AppState {
    pub fn initialize(app_dir: PathBuf) -> Result<Self, String> {
        let database = Arc::new(
            AppDatabase::open(app_dir.join("cluely-desktop.db"))
                .map_err(|error| error.to_string())?,
        );
        let secret_store: Arc<dyn AppSecretStore> =
            Arc::new(KeychainSecretStore::new("com.cluely.desktop"));
        let session_manager = SessionManager::new();
        let active_session = database
            .list_sessions()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|session| {
                matches!(
                    session.status.as_str(),
                    "active" | "paused" | "preparing" | "finishing"
                )
            });
        session_manager.restore(
            active_session.as_ref().map(|session| session.id.clone()),
            active_session.map(|session| session.status),
        );

        Ok(Self {
            app_dir: Arc::new(app_dir),
            search_runtime: SearchRuntime::new(Arc::clone(&database), Arc::clone(&secret_store)),
            repo_search_runtime: RepoSearchRuntime::new(Arc::clone(&database), Arc::clone(&secret_store)),
            insights_engine: InsightsEngine::new(Arc::clone(&database), Arc::clone(&secret_store)),
            database,
            secret_store,
            permissions: PermissionService::new(),
            providers: ProviderCatalog,
            audio_runtime: AudioRuntime::new(),
            session_manager,
            window_controller: WindowController::new(),
        })
    }

    pub fn app_dir(&self) -> Arc<PathBuf> {
        Arc::clone(&self.app_dir)
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

    pub fn search_runtime(&self) -> &SearchRuntime {
        &self.search_runtime
    }

    pub fn repo_search_runtime(&self) -> &RepoSearchRuntime {
        &self.repo_search_runtime
    }

    pub fn audio_runtime(&self) -> &AudioRuntime {
        &self.audio_runtime
    }

    pub fn session_manager(&self) -> &SessionManager {
        &self.session_manager
    }

    pub fn window_controller(&self) -> &WindowController {
        &self.window_controller
    }

    pub fn insights_engine(&self) -> &InsightsEngine {
        &self.insights_engine
    }
}
