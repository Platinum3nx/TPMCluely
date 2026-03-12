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

use app::commands::{
    append_transcript_segment, ask_assistant, bootstrap_app, complete_session, get_session_detail,
    list_sessions, mark_generated_ticket_pushed, pause_session, read_secret_value,
    resume_session, run_dynamic_action, save_generated_tickets, save_secret, save_setting,
    start_session,
};
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
            list_sessions,
            get_session_detail,
            start_session,
            pause_session,
            resume_session,
            complete_session,
            append_transcript_segment,
            run_dynamic_action,
            ask_assistant,
            save_setting,
            save_secret,
            read_secret_value,
            save_generated_tickets,
            mark_generated_ticket_pushed
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cluely Desktop");
}
