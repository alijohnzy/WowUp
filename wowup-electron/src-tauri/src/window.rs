//! Window controls — port of the window handlers in `app/ipc-events.ts` (Group G).
//!
//! These matter more under Tauri than they did under Electron. The window is created with
//! `decorations: false`, so the app's own titlebar is the *only* way to minimise, maximise
//! or close it; with these channels unmigrated the buttons were inert and the window could
//! only be killed from outside.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::constants::{
    IPC_WINDOW_ENTER_FULLSCREEN, IPC_WINDOW_LEAVE_FULLSCREEN, IPC_WINDOW_MAXIMIZED,
    IPC_WINDOW_MINIMIZED, IPC_WINDOW_UNMAXIMIZED,
};
use crate::store::{Stores, COLLAPSE_TO_TRAY_PREFERENCE_KEY, PREFERENCE_STORE_NAME};

/// Set once the user has actually asked to quit, so the close-to-tray interception knows to
/// stand aside. Mirrors `appIsQuitting` in app/main.ts.
#[derive(Default)]
pub struct Quitting(AtomicBool);

impl Quitting {
    pub fn set(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    fn is_quitting(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Resolve the app window rather than letting Tauri inject it.
///
/// These took a `WebviewWindow` parameter, which Tauri fills from the webview that made the
/// call. That stops working the moment the window holds more than one webview — the ad frame
/// adds a second — and every titlebar button then failed with "current webview is not a
/// WebviewWindow". Looking the window up by label is independent of who is calling.
fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "no main window".to_string())
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.minimize().map_err(|e| e.to_string())
}

/// Electron's handler toggles, and the renderer calls it for both maximise and restore.
#[tauri::command]
pub fn maximize_window(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn close_window(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn focus_window(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_maximized(app: AppHandle) -> Result<bool, String> {
    main_window(&app)?.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_full_screen(app: AppHandle) -> Result<bool, String> {
    main_window(&app)?
        .is_fullscreen()
        .map_err(|e| e.to_string())
}

/// The renderer offers a "leave fullscreen" button in its own titlebar, since a
/// decorationless window has no other way out.
#[tauri::command]
pub fn leave_full_screen(app: AppHandle) -> Result<(), String> {
    main_window(&app)?
        .set_fullscreen(false)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.state::<Quitting>().set();
    app.restart()
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    // Without this the close-to-tray handler below would swallow the quit and hide the
    // window instead, leaving no way to exit but the tray's own item.
    app.state::<Quitting>().set();
    app.exit(0)
}

/// Port of the `close` handler in app/main.ts:482.
///
/// Closing the window hides it to the tray rather than exiting, unless the user is quitting
/// or has turned the preference off. The preference is stored as the *string* `"true"` — see
/// `coerce_for_storage` — and the JS compares `!== "true"`, so anything else means "really
/// close", including the key being absent.
fn should_collapse_to_tray(app: &AppHandle) -> bool {
    if app.state::<Quitting>().is_quitting() {
        return false;
    }
    let stored = app
        .state::<Stores>()
        .get(app, PREFERENCE_STORE_NAME, COLLAPSE_TO_TRAY_PREFERENCE_KEY)
        .ok()
        .flatten();
    collapse_preference(stored.as_ref())
}

/// The `!== "true"` comparison, isolated so it can be tested.
fn collapse_preference(stored: Option<&serde_json::Value>) -> bool {
    stored.and_then(|v| v.as_str()) == Some("true")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_string_true_collapses_to_tray() {
        // electron-store stringifies primitives, so the preference is the *string* "true".
        // A JSON boolean would read as false here, exactly as it does in the JS.
        assert!(collapse_preference(Some(&json!("true"))));
        assert!(!collapse_preference(Some(&json!(true))));
        assert!(!collapse_preference(Some(&json!("false"))));
        assert!(!collapse_preference(Some(&json!(""))));
    }

    #[test]
    fn an_absent_preference_really_closes() {
        // `get(...) !== "true"` in the JS: unset means close, not hide.
        assert!(!collapse_preference(None));
    }
}

/// Mirrors Electron's BrowserWindow events onto the IPC channels the renderer listens for.
///
/// The titlebar swaps its maximise/restore glyph off these, so without them the icon goes
/// stale the moment the window is resized by the window manager rather than by the button.
pub fn forward_window_events(window: &WebviewWindow) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        // Close-to-tray. `close_window` (the titlebar X) goes through here too, since it
        // calls window.close().
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let collapse = should_collapse_to_tray(handle.app_handle());
            log::info!("close requested; collapse_to_tray={collapse}");
            if collapse {
                api.prevent_close();
                let _ = handle.hide();
                // Otherwise the window keeps a taskbar entry it can no longer be raised from.
                let _ = handle.set_skip_taskbar(true);
                return;
            }
        }

        let emit = |channel: &str| {
            if let Err(e) = handle.emit(channel, ()) {
                log::error!("failed to emit {channel}: {e}");
            }
        };

        match event {
            tauri::WindowEvent::Resized(_) => {
                // Tauri has no dedicated maximize/unmaximize event; a resize is where the
                // state can have changed, and the renderer only needs the current value.
                match handle.is_maximized() {
                    Ok(true) => emit(IPC_WINDOW_MAXIMIZED),
                    Ok(false) => emit(IPC_WINDOW_UNMAXIMIZED),
                    Err(e) => log::error!("is_maximized failed: {e}"),
                }
                match handle.is_fullscreen() {
                    Ok(true) => emit(IPC_WINDOW_ENTER_FULLSCREEN),
                    Ok(false) => emit(IPC_WINDOW_LEAVE_FULLSCREEN),
                    Err(e) => log::error!("is_fullscreen failed: {e}"),
                }
            }
            tauri::WindowEvent::Focused(false) => {
                if handle.is_minimized().unwrap_or(false) {
                    emit(IPC_WINDOW_MINIMIZED);
                }
            }
            _ => {}
        }
    });
}
