//! One-time import of an existing Electron install's data.
//!
//! The Tauri build uses its own identifier (`io.wowupcf.tauri`) and therefore its own data
//! directory, so it starts with no WoW installations and no addons — even on a machine
//! where the Electron build has both. That separation is deliberate: two applications
//! writing the same JSON files concurrently is a corruption risk, and during the migration
//! both are installed at once.
//!
//! Copying once on first run gives the same result without the shared-writer hazard. This
//! is not only a developer convenience — a user moving from the Electron build to the Tauri
//! one needs exactly this, or they lose 198 addon records and their client list.
//!
//! It works because electron-store's on-disk format is a flat `{key: value}` JSON object,
//! which is what store.rs reads and writes too (see `coerce_for_storage` — primitives are
//! stringified on both sides, so `'true'` means the same thing to each).

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::store::{ADDON_STORE_NAME, PREFERENCE_STORE_NAME, SENSITIVE_STORE_NAME};

/// Set once the import has been attempted, so it never runs twice and never clobbers data
/// the user has since changed in the Tauri build.
const IMPORT_MARKER_KEY: &str = "electron_data_imported";

const STORE_FILES: [&str; 3] = [PREFERENCE_STORE_NAME, ADDON_STORE_NAME, SENSITIVE_STORE_NAME];

/// Electron's `app.getPath("userData")` is `<config>/<app name>`. The names below are the
/// ones this repo's builds produce, most specific first: the Svelte build is the direct
/// predecessor of this one, then the CF flavour, then stock WowUp.
const ELECTRON_APP_NAMES: [&str; 3] = ["WowUpCfSvelte", "WowUpCf", "WowUp"];

fn electron_config_root() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
}

/// The first Electron data directory that actually holds a preferences file.
///
/// `WOWUP_IMPORT_FROM` overrides the search, which is what the test below uses and what a
/// user with a non-standard install can fall back on.
fn find_electron_data_dir() -> Option<PathBuf> {
    if let Some(override_dir) = std::env::var_os("WOWUP_IMPORT_FROM") {
        let dir = PathBuf::from(override_dir);
        return dir.join(format!("{PREFERENCE_STORE_NAME}.json")).is_file().then_some(dir);
    }

    let root = electron_config_root()?;
    ELECTRON_APP_NAMES
        .iter()
        .map(|name| root.join(name))
        .find(|dir| dir.join(format!("{PREFERENCE_STORE_NAME}.json")).is_file())
}

/// Copies the three store files from an Electron install, once.
///
/// Errors are logged and swallowed: failing to import is a much smaller problem than
/// failing to start, and the app is perfectly usable with an empty store.
pub fn import_electron_data(app: &AppHandle) {
    let Ok(target) = app.path().app_data_dir() else {
        log::warn!("[import] no app data dir; skipping");
        return;
    };

    let marker = target.join(".electron-import-done");
    if marker.exists() {
        return;
    }

    let Some(source) = find_electron_data_dir() else {
        log::info!("[import] no Electron install found; starting fresh");
        let _ = std::fs::create_dir_all(&target);
        let _ = std::fs::write(&marker, IMPORT_MARKER_KEY);
        return;
    };

    if let Err(e) = std::fs::create_dir_all(&target) {
        log::error!("[import] cannot create {}: {e}", target.display());
        return;
    }

    let mut copied = Vec::new();
    for name in STORE_FILES {
        let file = format!("{name}.json");
        let from = source.join(&file);
        if !from.is_file() {
            continue;
        }
        match std::fs::copy(&from, target.join(&file)) {
            Ok(bytes) => copied.push(format!("{file} ({bytes} bytes)")),
            Err(e) => log::error!("[import] failed to copy {}: {e}", from.display()),
        }
    }

    // Written last: if a copy panicked partway, the next launch retries rather than
    // leaving the user with half their addons.
    if let Err(e) = std::fs::write(&marker, IMPORT_MARKER_KEY) {
        log::error!("[import] could not write the marker: {e}");
    }

    log::info!(
        "[import] imported from {}: {}",
        source.display(),
        if copied.is_empty() { "nothing".to_string() } else { copied.join(", ") }
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The override path is what makes this testable at all — the real search reads the
    /// user's home directory.
    #[test]
    fn override_is_ignored_when_it_holds_no_preferences_file() {
        let dir = std::env::temp_dir().join("wowup-import-empty");
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("preferences.json"));

        std::env::set_var("WOWUP_IMPORT_FROM", &dir);
        let found = find_electron_data_dir();
        std::env::remove_var("WOWUP_IMPORT_FROM");

        assert!(found.is_none(), "a directory with no preferences.json is not an install");
    }

    #[test]
    fn override_is_used_when_it_holds_a_preferences_file() {
        let dir = std::env::temp_dir().join("wowup-import-real");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("preferences.json"), r#"{"a":"b"}"#).unwrap();

        std::env::set_var("WOWUP_IMPORT_FROM", &dir);
        let found = find_electron_data_dir();
        std::env::remove_var("WOWUP_IMPORT_FROM");

        assert_eq!(found.as_deref(), Some(dir.as_path()));
    }
}
