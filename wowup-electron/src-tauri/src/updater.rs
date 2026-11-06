//! App self-update from this fork's GitHub releases (`app-check-update`, `app-install-update`).
//!
//! The feed is `latest.json` on the fixed `tauri-updater` release, which the Tauri build
//! workflow rewrites on every published build (see `scripts/tauri-updater-manifest.mjs`).
//! `tauri-plugin-updater` reads it, picks the entry for this install — `linux-x86_64-appimage`,
//! `linux-x86_64-deb`, `windows-x86_64-nsis` — and checks the minisign signature against the
//! public key in `tauri.conf.json` before installing anything.
//!
//! Unlike Electron, which downloaded as soon as it found an update, this one asks first: a
//! check only reports `UpdateAvailable`, and the download starts when the user clicks the
//! footer's update button (`app-install-update`). There are no release channels — every
//! published build is offered to everyone.

use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// `IPC_APP_UPDATE_STATE` (src/common/constants.ts).
const IPC_APP_UPDATE_STATE: &str = "app-update-state";

/// Mirrors `AppUpdateState` (src/common/wowup/models.ts:1). `Serialize_repr` because the
/// renderer switches on the numeric value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde_repr::Serialize_repr)]
#[repr(u8)]
pub enum AppUpdateState {
    CheckingForUpdate = 1,
    UpdateAvailable = 2,
    UpdateNotAvailable = 3,
    Downloading = 4,
    // Not emitted: the install follows the download straight away, and the renderer's
    // Downloaded handler would ask the user a second time.
    #[allow(dead_code)]
    Downloaded = 5,
    Error = 6,
}

/// Mirrors `AppUpdateDownloadProgress` (src/common/wowup/models.ts).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgress {
    pub bytes_per_second: u64,
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
}

/// Mirrors `AppUpdateEvent` (src/common/wowup/models.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateEvent {
    pub state: AppUpdateState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<AppUpdateProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The version on offer, for `UpdateAvailable`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The release page, for installs that cannot update themselves (the portable zip).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    /// True when this copy has to be replaced by hand: the renderer opens `release_url`
    /// instead of calling `app-install-update`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub manual: bool,
}

impl AppUpdateEvent {
    fn state(state: AppUpdateState) -> Self {
        Self {
            state,
            progress: None,
            error: None,
            version: None,
            release_url: None,
            manual: false,
        }
    }

    fn error(message: impl Into<String>) -> Self {
        Self {
            error: Some(message.into()),
            ..Self::state(AppUpdateState::Error)
        }
    }
}

/// How this copy was installed, which decides whether and how it can replace itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
    AppImage,
    Deb,
    Rpm,
    Nsis,
    Msi,
    MacApp,
    /// The Windows portable zip: the bare executable carries no bundle marker. The updater
    /// would run the NSIS installer and leave a second, installed copy behind, so this one is
    /// only told where to download.
    WindowsPortable,
    /// `cargo run`, `tauri dev`, or the raw binary under target/: nothing to replace.
    Unpackaged,
}

impl InstallKind {
    /// From the marker the bundler patches into the executable (`tauri::utils::platform::
    /// bundle_type`). Pure, so it can be tested without building every bundle.
    pub fn from_bundle(bundle: Option<BundleType>, windows: bool) -> Self {
        match bundle {
            Some(BundleType::AppImage) => Self::AppImage,
            Some(BundleType::Deb) => Self::Deb,
            Some(BundleType::Rpm) => Self::Rpm,
            Some(BundleType::Nsis) => Self::Nsis,
            Some(BundleType::Msi) => Self::Msi,
            Some(BundleType::App) | Some(BundleType::Dmg) => Self::MacApp,
            None if windows => Self::WindowsPortable,
            None => Self::Unpackaged,
        }
    }

    pub fn current() -> Self {
        Self::from_bundle(tauri::utils::platform::bundle_type(), cfg!(windows))
    }

    fn self_updating(self) -> bool {
        !matches!(self, Self::WindowsPortable | Self::Unpackaged)
    }
}

/// Why a check is skipped, or `None` when this copy should check.
///
/// Only CI builds carry a build number (`2.25.4+18`); a local `npm run tauri:build` stays at
/// `2.25.4`, which every published build outranks. Without this, a build made from newer code
/// would offer to "update" itself to an older CI build.
pub fn skip_reason(version: &semver::Version, kind: InstallKind) -> Option<&'static str> {
    if version.build.is_empty() {
        Some("local build (no CI build number in the version)")
    } else if kind == InstallKind::Unpackaged {
        Some("not running from an installed bundle")
    } else {
        None
    }
}

/// The update found by the last check, kept until the user agrees to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

fn emit(app: &AppHandle, event: AppUpdateEvent) {
    if let Err(e) = app.emit(IPC_APP_UPDATE_STATE, event) {
        log::error!("could not emit {IPC_APP_UPDATE_STATE}: {e}");
    }
}

/// Port of `app-check-update`. Reports through `app-update-state` events, like Electron's
/// autoUpdater, rather than through the return value.
#[tauri::command]
pub async fn app_check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let kind = InstallKind::current();
    if let Some(reason) = skip_reason(&app.package_info().version, kind) {
        log::info!("app-check-update: skipped, {reason}");
        // Still answered, or the footer's check button would spin forever.
        emit(
            &app,
            AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable),
        );
        return Ok(());
    }

    emit(
        &app,
        AppUpdateEvent::state(AppUpdateState::CheckingForUpdate),
    );
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };

    match checked {
        Ok(Some(update)) => {
            log::info!(
                "app-check-update: {} available ({kind:?}), running {}",
                update.version,
                update.current_version
            );
            let release_url = update
                .raw_json
                .get("releaseUrl")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            emit(
                &app,
                AppUpdateEvent {
                    version: Some(update.version.clone()),
                    release_url,
                    manual: !kind.self_updating(),
                    ..AppUpdateEvent::state(AppUpdateState::UpdateAvailable)
                },
            );
            *pending.0.lock().map_err(|e| e.to_string())? = Some(update);
        }
        Ok(None) => {
            log::info!("app-check-update: up to date");
            emit(
                &app,
                AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable),
            );
        }
        Err(e) => {
            log::warn!("app-check-update failed: {e}");
            emit(&app, AppUpdateEvent::error(e.to_string()));
        }
    }
    Ok(())
}

/// Port of `app-install-update`: downloads the update the last check found, installs it, and
/// restarts. On Windows the NSIS installer takes over and relaunches the app itself.
#[tauri::command]
pub async fn app_install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let kind = InstallKind::current();
    if !kind.self_updating() {
        emit(
            &app,
            AppUpdateEvent::error(format!("{kind:?} installs are updated by hand")),
        );
        return Ok(());
    }

    let Some(update) = pending.0.lock().map_err(|e| e.to_string())?.take() else {
        emit(
            &app,
            AppUpdateEvent::error("No update to install; check again."),
        );
        return Ok(());
    };

    log::info!("app-install-update: downloading {}", update.version);
    let started = Instant::now();
    let mut transferred: u64 = 0;
    let mut last_percent = -1.0;
    let progress_app = app.clone();

    let result = update
        .download_and_install(
            move |chunk, total| {
                transferred += chunk as u64;
                let Some(progress) = progress(transferred, total, started.elapsed().as_secs_f64())
                else {
                    return;
                };
                // One event per whole percent; a chunk-per-event stream floods the IPC.
                if progress.percent.floor() > last_percent {
                    last_percent = progress.percent.floor();
                    emit(
                        &progress_app,
                        AppUpdateEvent {
                            progress: Some(progress),
                            ..AppUpdateEvent::state(AppUpdateState::Downloading)
                        },
                    );
                }
            },
            || log::info!("app-install-update: download finished, installing"),
        )
        .await;

    match result {
        Ok(()) => {
            log::info!("app-install-update: installed, restarting");
            // Otherwise close-to-tray would swallow the restart's close and only hide.
            app.state::<crate::window::Quitting>().set();
            app.restart();
        }
        Err(e) => {
            // A cancelled pkexec prompt for a .deb lands here too.
            log::error!("app-install-update failed: {e}");
            emit(&app, AppUpdateEvent::error(e.to_string()));
            Ok(())
        }
    }
}

/// Download progress in the renderer's shape. `None` while the server has not said how big
/// the file is, since a percentage of an unknown total would only mislead.
pub fn progress(
    transferred: u64,
    total: Option<u64>,
    elapsed_secs: f64,
) -> Option<AppUpdateProgress> {
    let total = total.filter(|t| *t > 0)?;
    Some(AppUpdateProgress {
        bytes_per_second: if elapsed_secs > 0.0 {
            (transferred as f64 / elapsed_secs) as u64
        } else {
            0
        },
        percent: (transferred as f64 * 100.0 / total as f64).min(100.0),
        transferred,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_markers_map_to_install_kinds() {
        assert_eq!(
            InstallKind::from_bundle(Some(BundleType::AppImage), false),
            InstallKind::AppImage
        );
        assert_eq!(
            InstallKind::from_bundle(Some(BundleType::Deb), false),
            InstallKind::Deb
        );
        assert_eq!(
            InstallKind::from_bundle(Some(BundleType::Nsis), true),
            InstallKind::Nsis
        );
        // The portable zip's executable is the raw build output, with no marker.
        assert_eq!(
            InstallKind::from_bundle(None, true),
            InstallKind::WindowsPortable
        );
        assert_eq!(
            InstallKind::from_bundle(None, false),
            InstallKind::Unpackaged
        );
    }

    #[test]
    fn only_installed_bundles_replace_themselves() {
        assert!(InstallKind::AppImage.self_updating());
        assert!(InstallKind::Deb.self_updating());
        assert!(InstallKind::Nsis.self_updating());
        assert!(!InstallKind::WindowsPortable.self_updating());
        assert!(!InstallKind::Unpackaged.self_updating());
    }

    #[test]
    fn local_builds_do_not_check() {
        let local = semver::Version::parse("2.25.4").unwrap();
        let ci = semver::Version::parse("2.25.4+18").unwrap();
        assert!(skip_reason(&local, InstallKind::AppImage).is_some());
        assert!(skip_reason(&ci, InstallKind::Unpackaged).is_some());
        assert_eq!(skip_reason(&ci, InstallKind::AppImage), None);
        // The portable zip still checks; it is told where to download.
        assert_eq!(skip_reason(&ci, InstallKind::WindowsPortable), None);
    }

    /// The updater's default comparison is `remote > current` on semver::Version, which only
    /// works for this scheme because semver orders build metadata numerically.
    #[test]
    fn ci_build_numbers_order_as_versions() {
        let v = |s: &str| semver::Version::parse(s).unwrap();
        assert!(v("2.25.4+18") > v("2.25.4+17"));
        assert!(v("2.25.4+100") > v("2.25.4+99"));
        assert!(v("2.25.5+1") > v("2.25.4+99"));
        assert!(v("2.25.4+1") > v("2.25.4"));
    }

    #[test]
    fn progress_is_reported_in_the_renderers_shape() {
        assert_eq!(progress(10, None, 1.0), None);
        assert_eq!(progress(10, Some(0), 1.0), None);
        let p = progress(50, Some(200), 2.0).unwrap();
        assert_eq!(p.percent, 25.0);
        assert_eq!(p.bytes_per_second, 25);
        let json = serde_json::to_value(&p).unwrap();
        assert!(
            json.get("bytesPerSecond").is_some() && json.get("percent").is_some(),
            "{json}"
        );
    }

    #[test]
    fn events_serialise_like_the_renderer_model() {
        let json = serde_json::to_value(AppUpdateEvent {
            version: Some("2.25.4+18".into()),
            release_url: Some("https://example/r".into()),
            manual: true,
            ..AppUpdateEvent::state(AppUpdateState::UpdateAvailable)
        })
        .unwrap();
        assert_eq!(json["state"], 2);
        assert_eq!(json["releaseUrl"], "https://example/r");
        assert_eq!(json["manual"], true);
        // Absent rather than null/false, as Electron's events were.
        let plain = serde_json::to_value(AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable))
            .unwrap();
        assert_eq!(plain, serde_json::json!({ "state": 3 }));
    }
}
