//! System tray — port of `app/system-tray.ts`.
//!
//! Built on demand from the renderer (`create-tray-menu`) rather than at startup, because
//! the labels are translated on the renderer side: the main process never knows the user's
//! language, so it cannot build this menu itself. That indirection is inherited from the
//! Electron build and is why this is a command rather than part of `setup`.

use serde::Deserialize;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

/// Mirrors `SystemTrayConfig` (src/common/wowup/models.ts:55).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTrayConfig {
    pub show_label: String,
    pub quit_label: String,
    /// Present in the contract but unused: the Electron build commented the entry out
    /// ("per discussion with zak") and this keeps the payload shape identical.
    #[serde(default)]
    pub check_update_label: String,
}

/// Holds the tray so it is not dropped — a `TrayIcon` unregisters itself when freed, which
/// is what makes a naive implementation flash an icon and then lose it.
#[derive(Default)]
pub struct TrayState(Mutex<Option<TrayIcon>>);

fn restore_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Unminimise first: `set_focus` on a minimised window is a no-op on some window
    // managers, which reads as the Show item doing nothing.
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn create_tray_menu(
    app: AppHandle,
    state: State<'_, TrayState>,
    config: SystemTrayConfig,
) -> Result<bool, String> {
    let name = app.package_info().name.clone();

    // A disabled first item showing the app name, matching the Electron menu.
    let title = MenuItemBuilder::with_id("title", &name)
        .enabled(false)
        .build(&app)
        .map_err(|e| e.to_string())?;
    let show = MenuItemBuilder::with_id("show", nonempty(&config.show_label, "Show"))
        .build(&app)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", nonempty(&config.quit_label, "Quit"))
        .build(&app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(&app)
        .items(&[&title, &show])
        .separator()
        .items(&[&quit])
        .build()
        .map_err(|e| e.to_string())?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no bundled window icon to use for the tray".to_string())?;

    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(&name)
        .menu(&menu)
        // Without this the menu also opens on left click, and the click-to-restore below
        // never fires.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click restores, which is what users expect of a tray icon and what the
            // Electron build did via its own click handler.
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    restore_window(tray.app_handle());
                }
            }
        })
        .build(&app)
        .map_err(|e| e.to_string())?;

    // Replacing the previous one: the renderer calls this again when the language changes.
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(tray);

    log::info!("tray created");
    Ok(true)
}

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_fall_back_when_the_renderer_sends_nothing() {
        // The Electron build did `config.showLabel || "Show"`; an untranslated key arrives as
        // an empty string, and a blank tray entry is worse than an English one.
        assert_eq!(nonempty("", "Show"), "Show");
        assert_eq!(nonempty("   ", "Quit"), "Quit");
        assert_eq!(nonempty("Anzeigen", "Show"), "Anzeigen");
    }

    #[test]
    fn config_deserialises_from_the_renderer_camel_case_payload() {
        let cfg: SystemTrayConfig = serde_json::from_str(
            r#"{"showLabel":"Show","quitLabel":"Quit","checkUpdateLabel":"Check"}"#,
        )
        .unwrap();
        assert_eq!(cfg.show_label, "Show");
        assert_eq!(cfg.quit_label, "Quit");
    }

    #[test]
    fn check_update_label_is_optional() {
        // It is unused, so a renderer that stops sending it must not break the command.
        let cfg: SystemTrayConfig =
            serde_json::from_str(r#"{"showLabel":"S","quitLabel":"Q"}"#).unwrap();
        assert_eq!(cfg.check_update_label, "");
    }
}
