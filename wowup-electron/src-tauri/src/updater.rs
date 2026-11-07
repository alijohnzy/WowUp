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
use tauri::{AppHandle, Emitter, State};
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
    /// True when the check was skipped because this copy was built from source, so the
    /// renderer can say so instead of "already up to date".
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub local_build: bool,
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
            local_build: false,
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
            AppUpdateEvent {
                local_build: true,
                ..AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable)
            },
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
            crate::tray::set_app_update(&app, Some(display_version(&update.version)));
            *pending.0.lock().map_err(|e| e.to_string())? = Some(update);
        }
        Ok(None) => {
            log::info!("app-check-update: up to date");
            crate::tray::set_app_update(&app, None);
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

    install_and_relaunch(&app, update, "app-install-update").await;
    Ok(())
}

/// Downloads `update`, installs it and restarts, reporting progress through
/// `app-update-state` events. Shared by updating and by installing an earlier version.
async fn install_and_relaunch(app: &AppHandle, update: Update, what: &str) {
    log::info!("{what}: downloading {}", update.version);
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
            || log::info!("download finished, installing"),
        )
        .await;

    match result {
        Ok(()) => {
            log::info!("{what}: installed, restarting");
            // Not Tauri's restart: from the AppImage it would hand the old mount's environment
            // to the new launcher, which then fails to start (see src/host.rs).
            crate::host::relaunch(app);
        }
        Err(e) => {
            // A cancelled pkexec prompt for a .deb lands here too.
            log::error!("{what} failed: {e}");
            emit(app, AppUpdateEvent::error(e.to_string()));
        }
    }
}

// ---- earlier versions ------------------------------------------------------------------
//
// "Install an earlier version" in Options, for when an update goes wrong. Every published
// build puts its updater manifest on its own release as updater.json (tauri-build.yml), so an
// earlier build is installed exactly like an update — same signature check, same installers
// — by pointing the updater at that release's manifest and accepting that one version.

/// The repository whose releases the updater reads. Must match plugins.updater.endpoints in
/// tauri.conf.json; a test keeps the two in step.
pub const RELEASES_REPO: &str = "alijohnzy/WowUp";

/// A release this copy can go back to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlierVersion {
    pub tag: String,
    /// e.g. `2.25.4+26`.
    pub version: String,
    pub published_at: String,
    pub release_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlierVersions {
    /// Newest first.
    pub versions: Vec<EarlierVersion>,
    /// False for the Windows portable zip, which is replaced by hand: the release page is
    /// offered instead.
    pub can_install: bool,
    /// Built from source: there is no release to go back from.
    pub local_build: bool,
}

/// The fields of GitHub's release listing that are used.
#[derive(Debug, serde::Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    pub published_at: Option<String>,
    pub html_url: String,
    #[serde(default)]
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, serde::Deserialize)]
pub struct GitHubAsset {
    pub name: String,
}

/// `tauri-v2.25.4-26` → `2.25.4+26`. Anything else is not a build release.
pub fn tag_version(tag: &str) -> Option<semver::Version> {
    let (base, build) = tag.strip_prefix("tauri-v")?.rsplit_once('-')?;
    build.parse::<u64>().ok()?;
    semver::Version::parse(&format!("{base}+{build}")).ok()
}

/// How many earlier releases are offered.
const EARLIER_VERSIONS_SHOWN: usize = 10;

/// The releases older than `current` that carry an updater manifest, newest first.
pub fn earlier_versions(
    releases: Vec<GitHubRelease>,
    current: &semver::Version,
) -> Vec<EarlierVersion> {
    let mut found: Vec<(semver::Version, EarlierVersion)> = releases
        .into_iter()
        .filter(|r| !r.draft && r.assets.iter().any(|a| a.name == "updater.json"))
        .filter_map(|r| {
            let version = tag_version(&r.tag_name)?;
            (version < *current).then(|| {
                (
                    version.clone(),
                    EarlierVersion {
                        tag: r.tag_name,
                        version: version.to_string(),
                        published_at: r.published_at.unwrap_or_default(),
                        release_url: r.html_url,
                    },
                )
            })
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found
        .into_iter()
        .take(EARLIER_VERSIONS_SHOWN)
        .map(|(_, v)| v)
        .collect()
}

#[tauri::command]
pub async fn app_list_earlier_versions(app: AppHandle) -> Result<EarlierVersions, String> {
    let kind = InstallKind::current();
    let current = app.package_info().version.clone();
    if skip_reason(&current, kind).is_some() {
        return Ok(EarlierVersions {
            versions: vec![],
            can_install: false,
            local_build: true,
        });
    }

    let url = format!("https://api.github.com/repos/{RELEASES_REPO}/releases?per_page=50");
    let text = reqwest::Client::new()
        .get(&url)
        .header(reqwest::header::USER_AGENT, "WowUpNight")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let releases: Vec<GitHubRelease> = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    Ok(EarlierVersions {
        versions: earlier_versions(releases, &current),
        can_install: kind.self_updating(),
        local_build: false,
    })
}

/// Installs the release `tag` in place of this version and restarts. Progress and failures
/// arrive as `app-update-state` events, as for an update.
#[tauri::command]
pub async fn app_install_version(app: AppHandle, tag: String) -> Result<(), String> {
    let kind = InstallKind::current();
    if !kind.self_updating() {
        emit(
            &app,
            AppUpdateEvent::error(format!("{kind:?} installs are changed by hand")),
        );
        return Ok(());
    }
    // Also what keeps the tag safe to put in the URL below.
    let wanted = tag_version(&tag).ok_or_else(|| format!("not a release: {tag}"))?;

    let manifest =
        format!("https://github.com/{RELEASES_REPO}/releases/download/{tag}/updater.json");
    let accept = wanted.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?])
        .and_then(|b| {
            b.version_comparator(move |_current, remote| remote.version == accept)
                .build()
        })
        .map_err(|e| e.to_string())?;

    emit(
        &app,
        AppUpdateEvent::state(AppUpdateState::CheckingForUpdate),
    );
    match updater.check().await {
        Ok(Some(update)) => install_and_relaunch(&app, update, "app-install-version").await,
        Ok(None) => emit(
            &app,
            AppUpdateEvent::error(format!("{wanted} has no build for this system")),
        ),
        Err(e) => {
            log::warn!("app-install-version {tag}: {e}");
            emit(&app, AppUpdateEvent::error(e.to_string()));
        }
    }
    Ok(())
}

/// A version as the footer shows it: `2.25.4+28` → `v2.25.4 #28`.
pub fn display_version(version: &str) -> String {
    match version.split_once('+') {
        Some((base, build)) => format!("v{base} #{build}"),
        None => format!("v{version}"),
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

    fn release(tag: &str, assets: &[&str]) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            draft: false,
            published_at: Some("2026-11-07T00:00:00Z".to_string()),
            html_url: format!("https://github.com/{RELEASES_REPO}/releases/tag/{tag}"),
            assets: assets
                .iter()
                .map(|name| GitHubAsset {
                    name: name.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn versions_are_shown_as_the_footer_shows_them() {
        assert_eq!(display_version("2.25.4+28"), "v2.25.4 #28");
        assert_eq!(display_version("2.25.4"), "v2.25.4");
    }

    #[test]
    fn release_tags_carry_the_build_number_as_build_metadata() {
        assert_eq!(
            tag_version("tauri-v2.25.4-26").unwrap().to_string(),
            "2.25.4+26"
        );
        assert_eq!(tag_version("tauri-updater"), None);
        assert_eq!(tag_version("tauri-v2.25.4-26/../x"), None);
        assert_eq!(tag_version("v2.25.4"), None);
    }

    #[test]
    fn only_older_releases_with_a_manifest_are_offered_newest_first() {
        let current = semver::Version::parse("2.25.4+27").unwrap();
        let mut draft = release("tauri-v2.25.4-25", &["updater.json"]);
        draft.draft = true;
        let offered = earlier_versions(
            vec![
                release("tauri-v2.25.4-23", &["updater.json"]),
                release("tauri-v2.25.4-26", &["x.AppImage", "updater.json"]),
                release("tauri-v2.25.4-24", &["x.AppImage"]), // no manifest
                release("tauri-v2.25.4-27", &["updater.json"]), // this one
                release("tauri-v2.25.4-28", &["updater.json"]), // newer
                release("tauri-updater", &["latest.json"]),
                draft,
            ],
            &current,
        );
        let versions: Vec<_> = offered.iter().map(|v| v.version.as_str()).collect();
        assert_eq!(versions, ["2.25.4+26", "2.25.4+23"]);
        assert_eq!(offered[0].tag, "tauri-v2.25.4-26");
    }

    #[test]
    fn at_most_ten_earlier_versions_are_offered() {
        let current = semver::Version::parse("2.25.4+100").unwrap();
        let releases = (1..40)
            .map(|n| release(&format!("tauri-v2.25.4-{n}"), &["updater.json"]))
            .collect();
        let offered = earlier_versions(releases, &current);
        assert_eq!(offered.len(), 10);
        assert_eq!(offered[0].version, "2.25.4+39");
    }

    #[test]
    fn releases_repo_matches_the_updater_endpoint() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let endpoint = conf["plugins"]["updater"]["endpoints"][0].as_str().unwrap();
        assert!(
            endpoint.starts_with(&format!("https://github.com/{RELEASES_REPO}/releases/")),
            "{endpoint}"
        );
    }

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
        let skipped = serde_json::to_value(AppUpdateEvent {
            local_build: true,
            ..AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable)
        })
        .unwrap();
        assert_eq!(skipped["localBuild"], true);
        // Absent rather than null/false, as Electron's events were.
        let plain = serde_json::to_value(AppUpdateEvent::state(AppUpdateState::UpdateNotAvailable))
            .unwrap();
        assert_eq!(plain, serde_json::json!({ "state": 3 }));
    }
}
