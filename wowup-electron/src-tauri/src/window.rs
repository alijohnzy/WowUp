//! Window controls — port of the window handlers in `app/ipc-events.ts` (Group G).
//!
//! These matter more under Tauri than they did under Electron. The window is created with
//! `decorations: false`, so the app's own titlebar is the *only* way to minimise, maximise
//! or close it; with these channels unmigrated the buttons were inert and the window could
//! only be killed from outside.

use tauri::{Emitter, WebviewWindow};

use crate::constants::{
    IPC_WINDOW_ENTER_FULLSCREEN, IPC_WINDOW_LEAVE_FULLSCREEN, IPC_WINDOW_MAXIMIZED,
    IPC_WINDOW_MINIMIZED, IPC_WINDOW_UNMAXIMIZED,
};

#[tauri::command]
pub fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Electron's handler toggles, and the renderer calls it for both maximise and restore.
#[tauri::command]
pub fn maximize_window(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn focus_window(window: WebviewWindow) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_full_screen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

/// The renderer offers a "leave fullscreen" button in its own titlebar, since a
/// decorationless window has no other way out.
#[tauri::command]
pub fn leave_full_screen(window: WebviewWindow) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart()
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0)
}

/// Mirrors Electron's BrowserWindow events onto the IPC channels the renderer listens for.
///
/// The titlebar swaps its maximise/restore glyph off these, so without them the icon goes
/// stale the moment the window is resized by the window manager rather than by the button.
pub fn forward_window_events(window: &WebviewWindow) {
    let handle = window.clone();
    window.on_window_event(move |event| {
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
