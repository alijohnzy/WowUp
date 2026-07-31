//! WowUp — Tauri main process.
//!
//! Replaces `app/main.ts` + `app/ipc-events.ts` + `app/controllers/`. Migrated one vertical
//! slice at a time; see `migration/tauri-scope.md` for the phase order. Only the Warcraft
//! slice is live so far — every other IPC channel is still served by the Electron build.

pub mod ad;
pub mod addons;
pub mod constants;
pub mod files;
pub mod fingerprint;
pub mod import;
pub mod install;
pub mod scanner;
pub mod store;
pub mod tray;
pub mod warcraft;
pub mod window;

/// Port of `get-locale` (app/ipc-events.ts:272), Electron's `app.getLocale()`.
///
/// Feeds `wowup.initializeLanguage()`, which picks the UI language on first run.
#[tauri::command]
fn get_locale() -> String {
    // Electron returns a BCP-47 tag like "en-GB"; plugin-os reads the same from the OS.
    tauri_plugin_os::locale().unwrap_or_else(|| "en".to_string())
}

/// Port of `update-app-badge` (app/ipc-events.ts:247), Electron's `app.setBadgeCount()`.
///
/// The count is the number of addons with updates available. macOS and Linux only, which
/// matches Electron — `setBadgeCount` is a no-op on Windows too.
#[tauri::command]
fn update_app_badge(app: tauri::AppHandle, count: Option<i64>) -> Result<(), String> {
    // Resolved from the app rather than injected as a `WebviewWindow`: once the ad frame adds
    // a second webview to the window, the calling webview is no longer *the* window's webview
    // and Tauri rejects the injection with "current webview is not a WebviewWindow".
    let window = app
        .get_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    // 0 clears the badge rather than drawing a zero.
    let value = count.filter(|c| *c > 0);
    window.set_badge_count(value).map_err(|e| e.to_string())
}

/// Port of `is-default-protocol-client` (app/ipc-events.ts:293).
#[tauri::command]
fn is_default_protocol_client(app: tauri::AppHandle, protocol: String) -> Result<bool, String> {
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link()
        .is_registered(&protocol)
        .map_err(|e| e.to_string())
}

/// Port of `set-as-default-protocol-client` (app/ipc-events.ts:297).
#[tauri::command]
fn set_as_default_protocol_client(app: tauri::AppHandle, protocol: String) -> Result<(), String> {
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link()
        .register(&protocol)
        .map_err(|e| e.to_string())
}

/// Port of `remove-as-default-protocol-client` (app/ipc-events.ts).
#[tauri::command]
fn remove_as_default_protocol_client(
    app: tauri::AppHandle,
    protocol: String,
) -> Result<(), String> {
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link()
        .unregister(&protocol)
        .map_err(|e| e.to_string())
}

/// Port of the `get-asset-file-path` handler (app/ipc-events.ts:214).
///
/// Electron joined against `app.getAppPath()`; the Tauri equivalent is the bundled
/// resource directory, which is where tauri.conf.json's `bundle.resources` land.
#[tauri::command]
fn get_asset_file_path(app: tauri::AppHandle, file_name: String) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource dir: {e}"))?;
    Ok(dir
        .join("assets")
        .join(file_name)
        .to_string_lossy()
        .into_owned())
}

/// Tauri's answer to the `user-data-path` / `log-path` arguments Electron passes through
/// preload (app/preload.ts:36) and hangs on `window` for the renderer to read.
///
/// Without these the renderer's `applicationFolderPath` is `''`, so every path derived from
/// it — `downloads/`, `wtf_backups/`, the updater — comes out *relative* and resolves
/// against the process working directory. In a packaged AppImage that is the read-only
/// squashfs mount, so every addon install failed with "Read-only file system (os error 30)"
/// after four retries.
#[tauri::command]
fn get_app_paths(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resolver = app.path();
    // Same directory the stores and the Electron import use, so a user's data stays in one
    // place rather than splitting across two roots.
    let user_data = resolver
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    let logs = resolver
        .app_log_dir()
        .map_err(|e| format!("no app log dir: {e}"))?;

    // The renderer joins onto these immediately; creating them here means the first install
    // does not race a missing parent.
    let _ = std::fs::create_dir_all(&user_data);

    Ok(serde_json::json!({
        "userDataPath": user_data.to_string_lossy(),
        "logPath": logs.to_string_lossy(),
    }))
}

/// Port of the `get-app-version` handler in app/ipc-events.ts.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        // The ad frame is an <iframe> on its own origin; this serves it. See src/ad.rs for
        // why it is proxied rather than framed directly, and why that origin matters.
        .register_asynchronous_uri_scheme_protocol(ad::AD_SCHEME, |_ctx, request, responder| {
            tauri::async_runtime::spawn(async move {
                responder.respond(ad::serve(request).await);
            });
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                // Debug, because the renderer narrates its addon sync with console.debug —
                // at Info the sync is a black box, which is exactly the wrong place to be
                // blind when addons stop reporting updates.
                .level(log::LevelFilter::Debug)
                // ...but only ours. reqwest logs a line per connection and hyper logs the
                // wire, which buries the app's own output and puts request URLs in a file
                // users attach to bug reports.
                .level_for("tao", log::LevelFilter::Info)
                .level_for("wry", log::LevelFilter::Info)
                .level_for("reqwest", log::LevelFilter::Info)
                .level_for("hyper", log::LevelFilter::Info)
                .level_for("hyper_util", log::LevelFilter::Info)
                .level_for("rustls", log::LevelFilter::Info)
                .build(),
        )
        .manage(store::Stores::default())
        .manage(tray::TrayState::default())
        .manage(window::Quitting::default())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_app_paths,
            files::path_exists,
            files::read_file,
            files::read_file_buffer,
            files::list_directories,
            files::get_latest_dir_update_time,
            files::create_directory,
            files::delete_directory,
            files::write_file,
            files::copy_file,
            files::get_home_dir,
            files::show_directory,
            files::stat_files,
            files::list_files,
            files::readdir,
            install::download_file,
            install::unzip_file,
            scanner::curse_get_scan_results,
            scanner::wowup_get_scan_results,
            tray::create_tray_menu,
            window::minimize_window,
            window::maximize_window,
            window::close_window,
            window::focus_window,
            window::window_is_maximized,
            window::window_is_full_screen,
            window::leave_full_screen,
            window::restart_app,
            window::quit_app,
            get_locale,
            update_app_badge,
            is_default_protocol_client,
            set_as_default_protocol_client,
            remove_as_default_protocol_client,
            get_asset_file_path,
            addons::addons_get_all,
            addons::addons_get_all_for_installation,
            addons::addons_get_all_for_provider,
            addons::addons_get_by_external_id,
            addons::addons_get_by_external_ids,
            addons::addons_get_available_for_update,
            addons::addons_get_auto_update_enabled,
            addons::addons_save_all,
            store::store_get_object,
            store::store_get_all,
            store::store_set_object,
            store::store_remove_object,
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
        .setup(|app| {
            log::info!("WowUp Tauri starting");
            // Before any store is touched: the Tauri build has its own data directory, so
            // without this a machine with an existing Electron install starts with no WoW
            // clients and no addons.
            import::import_electron_data(app.handle());

            // The window is decorationless, so its own titlebar is the only way to move or
            // close it; these events keep the maximise glyph in step with the real state.
            if let Some(main) = app.get_webview_window("main") {
                window::forward_window_events(&main);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
