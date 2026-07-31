//! WowUp — Tauri main process.
//!
//! Replaces `app/main.ts` + `app/ipc-events.ts` + `app/controllers/`. Migrated one vertical
//! slice at a time; see `migration/tauri-scope.md` for the phase order. Only the Warcraft
//! slice is live so far — every other IPC channel is still served by the Electron build.

pub mod warcraft;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            warcraft::warcraft_get_blizzard_agent_path,
            warcraft::warcraft_get_installed_products,
            warcraft::warcraft_get_executable_name,
            warcraft::warcraft_get_client_type_for_binary,
            warcraft::warcraft_is_wow_application,
            warcraft::warcraft_get_executable_extension,
        ])
        // A reload loop is otherwise silent — the app just never finishes starting. Logging
        // every page load makes it obvious, and costs two lines a boot when healthy.
        .on_page_load(|_webview, payload| {
            log::info!("page load {:?} {}", payload.event(), payload.url());
        })
        .setup(|_app| {
            log::info!("WowUp Tauri starting");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
