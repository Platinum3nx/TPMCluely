pub mod app;
pub mod audio;
pub mod db;
pub mod exports;
pub mod knowledge;
pub mod permissions;
pub mod prompts;
pub mod providers;
pub mod screenshot;
pub mod secrets;
pub mod session;
pub mod tickets;
pub mod transcript;
pub mod window;

use std::fs;

use app::commands::{bootstrap_app, save_secret, save_setting};
use app::state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            fs::create_dir_all(&app_dir)?;
            let state =
                AppState::initialize(app_dir).map_err(|error| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::other(error))
                })?;
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_app,
            save_setting,
            save_secret
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cluely Desktop");
}
