//! WowUp — Tauri main process.
//!
//! Replaces `app/main.ts` + `app/ipc-events.ts` + `app/controllers/`. Migrated one vertical
//! slice at a time; see `migration/tauri-scope.md` for the phase order. Only the Warcraft
//! slice is live so far — every other IPC channel is still served by the Electron build.

pub mod ad_view;
pub mod addons;
pub mod constants;
pub mod files;
pub mod fingerprint;
pub mod host;
pub mod import;
pub mod install;
pub mod scanner;
pub mod store;
pub mod tray;
pub mod updater;
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

/// The git commit this binary was built from (see build.rs). The footer shows it for local
/// builds, which have no CI build number to tell them apart. Empty if git was unavailable.
#[tauri::command]
fn get_build_commit() -> &'static str {
    env!("WOWUP_BUILD_COMMIT")
}

use tauri::Manager;

const WEBKIT_DMABUF_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Whether to turn off WebKitGTK's DMABUF renderer before WebKit starts.
///
/// Inside the AppImage the renderer left the page blank — the window showed only its #444444
/// background — while the page kept running behind it (its logs carried on, and a resize did
/// not bring it back). Measured on KDE Wayland/XWayland with AMD graphics: the AppImage came
/// up blank 3 times out of 3 after a restore from the tray, and 0 out of 3 with this set. The
/// same binary run outside the AppImage was fine, so .deb installs keep the GPU path. A value
/// the user set themselves is left alone.
fn should_disable_dmabuf(
    appimage: Option<&std::ffi::OsStr>,
    existing: Option<&std::ffi::OsStr>,
) -> bool {
    appimage.is_some_and(|a| !a.is_empty()) && existing.is_none()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_panics();

    // Before GTK and WebKit initialise, and before any other thread exists to race set_var.
    #[cfg(target_os = "linux")]
    if should_disable_dmabuf(
        host::appimage_path().as_deref(),
        std::env::var_os(WEBKIT_DMABUF_VAR).as_deref(),
    ) {
        std::env::set_var(WEBKIT_DMABUF_VAR, "1");
    }

    tauri::Builder::default()
        // First, as the plugin requires: a second launch — the launcher clicked again, or
        // autostart while the app already sits in the tray — hands over to the copy that is
        // running and exits, instead of opening a second window on the same data. The running
        // copy comes forward the way the tray's Show item brings it.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            log::info!("second launch: bringing the running window forward");
            tray::restore_window(app);
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Start-with-system. The flag matches what Electron registers; nothing reads it, since
        // the plugin would pass it whether or not the user asked to start minimised — see
        // `window::should_start_hidden`.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![window::HIDDEN_FLAG]),
        ))
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
                // The plugin's defaults are 40 KB and KeepOne, which at Debug level deleted the
                // whole log every few minutes, taking "Dump debug data" and anything a bug
                // report needed with it. The Debug page promises "your last couple of log files".
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
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
        .manage(updater::PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_build_commit,
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
            files::list_entries,
            files::list_dir_recursive,
            files::get_directory_tree,
            files::rename_file,
            files::show_item_in_folder,
            files::show_open_dialog,
            install::download_file,
            install::unzip_file,
            install::zip_file,
            install::zip_list_files,
            install::zip_read_file,
            scanner::curse_get_scan_results,
            scanner::wowup_get_scan_results,
            tray::create_tray_menu,
            tray::set_tray_update_count,
            window::minimize_window,
            window::maximize_window,
            window::close_window,
            window::focus_window,
            window::window_is_maximized,
            window::window_is_full_screen,
            window::leave_full_screen,
            window::restart_app,
            window::quit_app,
            window::get_zoom_factor,
            window::set_zoom_factor,
            window::set_zoom_limits,
            window::get_login_item_settings,
            window::set_login_item_settings,
            updater::app_check_update,
            updater::app_install_update,
            updater::app_list_earlier_versions,
            updater::app_install_version,
            ad_view::ad_view_set_bounds,
            ad_view::ad_view_reload,
            host::open_external_url,
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
            #[cfg(target_os = "linux")]
            if let Some(v) = std::env::var_os(WEBKIT_DMABUF_VAR) {
                log::info!("{WEBKIT_DMABUF_VAR}={}", v.to_string_lossy());
            }
            // Before any store is touched: the Tauri build has its own data directory, so
            // without this a machine with an existing Electron install starts with no WoW
            // clients and no addons.
            import::import_electron_data(app.handle());

            // The window is decorationless, so its own titlebar is the only way to move or
            // close it; these events keep the maximise glyph in step with the real state.
            if let Some(main) = app.get_webview_window("main") {
                // Applied explicitly. The window came up with no _NET_WM_ICON at all, so the
                // window manager fell back to matching WM_CLASS ("wowup") against the icon
                // theme — where nothing of that name is installed, since an AppImage is not
                // desktop-integrated until something integrates it. Alt-tab drew whatever
                // generic icon it had. Setting the property means the icon travels with the
                // window and needs no installed theme entry.
                if let Some(icon) = app.default_window_icon().cloned() {
                    if let Err(e) = main.set_icon(icon) {
                        log::warn!("could not set the window icon: {e}");
                    }
                }
                window::forward_window_events(&main);

                // The ad view goes on an overlay over the page; it has to be set up before
                // the window is first shown. See src/ad_view.rs.
                #[cfg(target_os = "linux")]
                if let Err(e) = ad_view::install_overlay(&main) {
                    log::error!("could not set up the ad overlay: {e}");
                }

                // The window is configured `visible: false` so that a hidden start never
                // flashes one up. That makes showing it this app's job on every other
                // launch — miss this and the app runs with no window at all.
                if window::should_start_hidden(app.handle()) {
                    log::info!("start_minimized is on; starting hidden, the tray is the way back");
                    // A window that was never shown is not in the taskbar anyway, but the
                    // flag is what `restore_window` clears, so set it for symmetry with the
                    // close-to-tray path.
                    let _ = main.set_skip_taskbar(true);
                    window::set_in_dock(app.handle(), false);
                } else if let Err(e) = main.show() {
                    log::error!("could not show the main window: {e}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // How the app ends, which the log otherwise never said: a report of "it quit" could
            // not be told apart from a crash, or from the user quitting.
            match &_event {
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!("exit requested (code {code:?})")
                }
                tauri::RunEvent::Exit => log::info!("exiting"),
                _ => {}
            }

            // macOS: clicking the Dock icon, or opening the app again from Applications or
            // Spotlight, reaches the running copy as Reopen rather than as a second launch, so
            // the single-instance handler above never sees it. With the window closed to the
            // tray, or started hidden, the tray icon was then the only way back — and on a
            // MacBook with a notch, the menu bar often hides it.
            //
            // Decided by our own window, not by the event's `has_visible_windows`: build 38
            // trusted that, and a window started hidden still never came back. AppKit counts
            // every window the app owns, and the menu bar icon is one — so with the tray up
            // the answer is presumably always yes.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                let hidden = _app.get_webview_window("main").is_some_and(|w| {
                    !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false)
                });
                log::info!("reopened from the Dock; window hidden={hidden}");
                if hidden {
                    tray::restore_window(_app);
                }
            }
        });
}

/// Panics go to the log file, with where they happened.
///
/// Rust prints a panic to stderr, which nobody sees when the app is started from a launcher.
/// On macOS that hid the cause of the app quitting outright: tao catches a panic in its event
/// handling, stops the app and exits with 101 — no crash report, nothing in the log. (The log
/// plugin is not running yet when this is installed; panics before it starts still reach
/// stderr through the default hook.)
fn log_panics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        log::error!(
            "panic on thread {}: {info}\n{}",
            thread.name().unwrap_or("<unnamed>"),
            std::backtrace::Backtrace::force_capture()
        );
        default_hook(info);
    }));
}

#[cfg(test)]
mod dmabuf_tests {
    use super::should_disable_dmabuf;
    use std::ffi::OsStr;

    #[test]
    fn only_appimages_turn_the_dmabuf_renderer_off() {
        let appimage = Some(OsStr::new("/home/u/Applications/WowUp-CF-Tauri.AppImage"));
        assert!(should_disable_dmabuf(appimage, None));
        // A .deb install or the raw binary keeps the GPU path.
        assert!(!should_disable_dmabuf(None, None));
        assert!(!should_disable_dmabuf(Some(OsStr::new("")), None));
        // Whatever the user set wins, including asking for the renderer back.
        assert!(!should_disable_dmabuf(appimage, Some(OsStr::new("0"))));
    }
}
