//! Download and unzip — the install/update path.
//!
//! Ports `handleDownloadFile` (app/ipc-events.ts:649) and the `unzip-file` handler (:409).
//! Together with the scanners these are what let an addon actually be installed or updated;
//! without them the app can detect an update and do nothing about it.
//!
//! Replaces `yauzl` and Electron's `net.request`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// `DEFAULT_FILE_MODE` (src/common/constants.ts:200). Octal 655 in the original — unusual
/// (owner rw, group/other r-x) but reproduced rather than "corrected", because addon files
/// are compared against what the Electron build wrote.
#[cfg(unix)]
const DEFAULT_FILE_MODE: u32 = 0o655;

/// Mirrors `DownloadAuth` (wowup-lib-core).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAuth {
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub query_params: Option<HashMap<String, String>>,
}

/// Mirrors `DownloadRequest` (src/common/models/download-request.ts).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub file_name: String,
    pub output_folder: String,
    pub response_key: String,
    #[serde(default)]
    pub auth: Option<DownloadAuth>,
}

/// Mirrors `DownloadStatusType` (download-status-type.ts): Pending, Progress, Complete, Error.
///
/// `Serialize_repr`, not the derive: it has to cross as a bare number. The renderer compares
/// `status.type !== DownloadStatusType.Progress` and then switches on it, so a variant name
/// would unsubscribe the listener, match no case, and leave the download promise pending
/// forever — an install that hangs with no error.
#[derive(Debug, Clone, Copy, serde_repr::Serialize_repr)]
#[repr(u8)]
enum DownloadStatusType {
    #[allow(dead_code)]
    Pending = 0,
    #[allow(dead_code)]
    Progress = 1,
    Complete = 2,
    Error = 3,
}

/// Mirrors `DownloadStatus`.
///
/// `error` is a string rather than an Error: Tauri's IPC is JSON, so an Error would arrive
/// as `{}` and the renderer's `reject(status.error)` would produce an empty rejection with
/// nothing to show the user.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadStatus {
    #[serde(rename = "type")]
    status_type: DownloadStatusType,
    #[serde(skip_serializing_if = "Option::is_none")]
    save_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Port of `download-file`.
///
/// Fire-and-forget in the renderer (`send`), with the outcome delivered on the caller's own
/// `responseKey` channel — that is how concurrent downloads stay apart. Electron emits only
/// Complete and Error, never Progress, so the install bar does not move during the download;
/// reproduced rather than improved, since the renderer's `onProgress` is wired and emitting
/// Progress here would be a visible behaviour change.
#[tauri::command]
pub async fn download_file(app: AppHandle, request: DownloadRequest) {
    let response_key = request.response_key.clone();

    let status = match perform_download(request).await {
        Ok(save_path) => DownloadStatus {
            status_type: DownloadStatusType::Complete,
            save_path: Some(save_path),
            error: None,
        },
        Err(e) => {
            log::error!("[DownloadFile] {e}");
            DownloadStatus {
                status_type: DownloadStatusType::Error,
                save_path: None,
                error: Some(e),
            }
        }
    };

    if let Err(e) = app.emit(&response_key, status) {
        // The renderer's promise never settles if this is lost, so it is worth saying.
        log::error!("[DownloadFile] could not report on {response_key}: {e}");
    }
}

async fn perform_download(request: DownloadRequest) -> Result<String, String> {
    // A relative folder resolves against the process working directory, which is nowhere the
    // caller meant. In a packaged AppImage that is the read-only mount and this surfaced as
    // "Read-only file system (os error 30)" on every install; run from a writable directory
    // it would instead have silently scattered downloads next to the binary. The renderer
    // only ever sends absolute paths, so anything else means the shell failed to hand over
    // `userDataPath` — say that rather than the errno.
    if !Path::new(&request.output_folder).is_absolute() {
        return Err(format!(
            "refusing to download to the relative path '{}' — the app data directory was not \
             resolved before install",
            request.output_folder
        ));
    }

    tokio::fs::create_dir_all(&request.output_folder)
        .await
        .map_err(|e| format!("{}: {e}", request.output_folder))?;

    let mut url = reqwest::Url::parse(&request.url).map_err(|e| format!("{}: {e}", request.url))?;
    if let Some(params) = request.auth.as_ref().and_then(|a| a.query_params.as_ref()) {
        for (key, value) in params {
            url.query_pairs_mut().append_pair(key, value);
        }
    }

    // The nanoid prefix is what lets two downloads of the same file name coexist.
    let save_path = Path::new(&request.output_folder).join(format!(
        "{}-{}",
        nanoid::nanoid!(),
        request.file_name
    ));
    log::info!("[DownloadFile] '{url}' -> '{}'", save_path.display());

    let mut req = reqwest::Client::new().get(url.clone());
    if let Some(headers) = request.auth.as_ref().and_then(|a| a.headers.as_ref()) {
        for (key, value) in headers {
            // Never log the value: these carry CurseForge and Wago tokens.
            log::info!("Setting header: {key}=***");
            req = req.header(key, value);
        }
    }

    let response = req.send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Invalid response ({}): {url}", status.as_u16()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("{url}: {e}"))?;
    tokio::fs::write(&save_path, &bytes)
        .await
        .map_err(|e| format!("{}: {e}", save_path.display()))?;

    Ok(save_path.to_string_lossy().into_owned())
}

/// Mirrors `UnzipRequest`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnzipRequest {
    pub zip_file_path: String,
    pub output_folder: String,
}

/// Port of `unzip-file`. Returns the output folder, which is what the renderer installs from.
#[tauri::command]
pub async fn unzip_file(request: UnzipRequest) -> Result<String, String> {
    let output = request.output_folder.clone();

    // Blocking: a large addon zip would otherwise stall Tauri's async runtime and freeze the
    // UI mid-install.
    tauri::async_runtime::spawn_blocking(move || {
        extract(&request.zip_file_path, &request.output_folder)?;
        chmod_dir(Path::new(&request.output_folder))
    })
    .await
    .map_err(|e| format!("unzip panicked: {e}"))??;

    Ok(output)
}

fn extract(zip_path: &str, target_dir: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("{zip_path}: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("{zip_path}: {e}"))?;
    let target = Path::new(target_dir);

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("{zip_path}: {e}"))?;

        // Zip-slip. The yauzl version joined the entry name onto the target directly, so an
        // archive containing `../../.bashrc` would write outside the addon folder. Addon zips
        // are third-party content downloaded over the network, so this is worth refusing
        // rather than inheriting.
        let Some(relative) = safe_entry_path(entry.name()) else {
            log::warn!(
                "[Unzip] refusing entry outside the target: {}",
                entry.name()
            );
            continue;
        };
        let out_path = target.join(relative);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("{}: {e}", out_path.display()))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }

        let mut out =
            std::fs::File::create(&out_path).map_err(|e| format!("{}: {e}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("{}: {e}", out_path.display()))?;
        out.flush()
            .map_err(|e| format!("{}: {e}", out_path.display()))?;
    }

    Ok(())
}

/// `None` for anything that would escape the target directory: absolute paths, `..`
/// components, Windows drive prefixes.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    // Zip entries always use forward slashes, but archives built on Windows sometimes do not.
    let normalised = name.replace('\\', "/");
    let path = Path::new(&normalised);

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            // A leading `./` is harmless.
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    (!out.as_os_str().is_empty()).then_some(out)
}

/// Port of `chmodDir` (file.utils.ts:62) — every file beneath the directory, recursively.
fn chmod_dir(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let entries =
                std::fs::read_dir(&current).map_err(|e| format!("{}: {e}", current.display()))?;
            for entry in entries {
                let entry = entry.map_err(|e| format!("{}: {e}", current.display()))?;
                let path = entry.path();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(path);
                } else {
                    std::fs::set_permissions(
                        &path,
                        std::fs::Permissions::from_mode(DEFAULT_FILE_MODE),
                    )
                    .map_err(|e| format!("{}: {e}", path.display()))?;
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = dir;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_paths_that_escape_the_target_are_refused() {
        // Addon zips are third-party content fetched over the network.
        assert!(safe_entry_path("../../.bashrc").is_none());
        assert!(safe_entry_path("WeakAuras/../../evil").is_none());
        assert!(safe_entry_path("/etc/passwd").is_none());
        assert!(safe_entry_path("..\\..\\evil.lua").is_none());
    }

    #[test]
    fn ordinary_entry_paths_are_kept() {
        assert_eq!(
            safe_entry_path("WeakAuras/Core.lua"),
            Some(PathBuf::from("WeakAuras/Core.lua"))
        );
        assert_eq!(
            safe_entry_path("./WeakAuras/UI.xml"),
            Some(PathBuf::from("WeakAuras/UI.xml"))
        );
        // Windows-built archives sometimes use backslashes.
        assert_eq!(
            safe_entry_path("WeakAuras\\Sub\\A.lua"),
            Some(PathBuf::from("WeakAuras/Sub/A.lua"))
        );
    }

    #[test]
    fn an_empty_entry_name_is_refused() {
        assert!(safe_entry_path("").is_none());
        assert!(safe_entry_path("./").is_none());
    }

    #[test]
    fn download_status_serialises_the_way_the_renderer_reads_it() {
        // `type` is a bare number matched against the DownloadStatusType enum, and `error`
        // must be a string — an Error would cross as {} and reject with nothing to show.
        let json = serde_json::to_string(&DownloadStatus {
            status_type: DownloadStatusType::Complete,
            save_path: Some("/tmp/a.zip".into()),
            error: None,
        })
        .unwrap();
        assert!(json.contains("\"type\":2"), "got {json}");
        assert!(json.contains("\"savePath\":\"/tmp/a.zip\""), "got {json}");
        assert!(!json.contains("error"), "got {json}");

        let err = serde_json::to_string(&DownloadStatus {
            status_type: DownloadStatusType::Error,
            save_path: None,
            error: Some("boom".into()),
        })
        .unwrap();
        assert!(
            err.contains("\"type\":3") && err.contains("\"error\":\"boom\""),
            "got {err}"
        );
    }

    /// A relative output folder means the shell never handed the renderer its data directory,
    /// so `join(applicationFolderPath, 'downloads')` collapsed to bare `downloads`. Packaged
    /// as an AppImage the working directory is the read-only mount, and every install failed
    /// with a bare "Read-only file system (os error 30)" after four retries — no indication
    /// that the path was the problem. Fail before the write, and name the actual cause.
    #[tokio::test]
    async fn download_refuses_a_relative_output_folder() {
        let err = perform_download(DownloadRequest {
            url: "https://example.invalid/a.zip".into(),
            file_name: "a.zip".into(),
            output_folder: "downloads".into(),
            response_key: "k".into(),
            auth: None,
        })
        .await
        .expect_err("a relative output folder must not be written to");

        assert!(err.contains("relative path 'downloads'"), "got {err}");
        // Nothing should have been created next to the binary.
        assert!(!Path::new("downloads").exists());
    }

    #[test]
    fn download_request_deserialises_from_the_renderer_payload() {
        let req: DownloadRequest = serde_json::from_str(
            r#"{"url":"https://x/y.zip","fileName":"y.zip","outputFolder":"/tmp",
                "responseKey":"abc","auth":{"headers":{"x-api-key":"k"}}}"#,
        )
        .unwrap();
        assert_eq!(req.file_name, "y.zip");
        assert_eq!(req.response_key, "abc");
        assert_eq!(req.auth.unwrap().headers.unwrap()["x-api-key"], "k");
    }

    #[test]
    fn auth_is_optional() {
        // Most downloads have none; a missing key must not fail deserialisation.
        let req: DownloadRequest = serde_json::from_str(
            r#"{"url":"https://x/y.zip","fileName":"y.zip","outputFolder":"/tmp","responseKey":"a"}"#,
        )
        .unwrap();
        assert!(req.auth.is_none());
    }

    /// Exercises the real HTTP + extraction path against a live addon zip, into a temp
    /// directory. Ignored by default because it needs the network; run with
    /// `cargo test --lib -- --ignored live_download`.
    #[tokio::test]
    #[ignore]
    async fn live_download_and_unzip() {
        let dir = std::env::temp_dir().join("wowup-live-download");
        let _ = std::fs::remove_dir_all(&dir);

        let url = std::env::var("WOWUP_TEST_ZIP_URL")
            .unwrap_or_else(|_| "https://github.com/Stanzilla/AdvancedInterfaceOptions/archive/refs/heads/master.zip".into());

        let saved = perform_download(DownloadRequest {
            url,
            file_name: "addon.zip".into(),
            output_folder: dir.to_string_lossy().into_owned(),
            response_key: "test".into(),
            auth: None,
        })
        .await
        .expect("download failed");

        let size = std::fs::metadata(&saved).unwrap().len();
        assert!(size > 1024, "suspiciously small download: {size} bytes");
        // The nanoid prefix is what keeps concurrent downloads of the same name apart.
        assert!(saved.ends_with("-addon.zip"), "{saved}");

        let out = dir.join("unzipped");
        extract(&saved, out.to_str().unwrap()).expect("extract failed");
        chmod_dir(&out).expect("chmod failed");

        let entries: Vec<_> = std::fs::read_dir(&out)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(!entries.is_empty(), "extracted nothing");
    }

    #[test]
    fn extracts_an_archive_and_refuses_traversal() {
        use std::io::Write as _;

        let root = std::env::temp_dir().join("wowup-unzip-test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let zip_path = root.join("addon.zip");
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            zip.start_file("WeakAuras/Core.lua", opts).unwrap();
            zip.write_all(b"-- core").unwrap();
            zip.start_file("../escaped.lua", opts).unwrap();
            zip.write_all(b"-- nope").unwrap();
            zip.finish().unwrap();
        }

        let out = root.join("out");
        extract(zip_path.to_str().unwrap(), out.to_str().unwrap()).unwrap();

        assert!(out.join("WeakAuras/Core.lua").is_file());
        assert!(
            !root.join("escaped.lua").exists(),
            "zip-slip entry was written"
        );
    }
}
