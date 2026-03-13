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
    append_transcript_segment, ask_assistant, bootstrap_app, complete_session,
    delete_knowledge_file, delete_system_prompt, export_session_markdown, get_runtime_state,
    get_capture_status, get_session_detail, list_knowledge_files, list_sessions,
    list_system_audio_sources, list_system_prompts, mark_generated_ticket_pushed, pause_session,
    read_secret_value, resume_session, run_dynamic_action, save_generated_tickets,
    save_knowledge_file, save_secret, save_setting, save_system_prompt, search_sessions,
    set_overlay_open, start_session, start_system_audio_capture, stop_system_audio_capture,
};
use app::state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            list_system_audio_sources,
            get_capture_status,
            start_session,
            start_system_audio_capture,
            pause_session,
            resume_session,
            stop_system_audio_capture,
            complete_session,
            append_transcript_segment,
            run_dynamic_action,
            ask_assistant,
            save_setting,
            save_secret,
            read_secret_value,
            save_generated_tickets,
            mark_generated_ticket_pushed,
            get_runtime_state,
            set_overlay_open,
            search_sessions,
            export_session_markdown,
            list_system_prompts,
            save_system_prompt,
            delete_system_prompt,
            list_knowledge_files,
            save_knowledge_file,
            delete_knowledge_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TPMCluely");
}
