//! Filesystem commands — the start of Group A (`app/ipc-events.ts`).
//!
//! Only the two the addon scanner needs so far. Deliberately not `plugin-fs`: that plugin
//! gates every path through a scope allowlist, and this app reads arbitrary WoW install
//! directories the user chose — which is what `app/file.utils.ts` does today. Scoping that
//! properly is worth doing, but as its own decision rather than as a side effect of needing
//! `readdir`.

/// Port of `path-exists` (app/ipc-events.ts:364).
///
/// The JS returns false for an empty path and for ENOENT, and rethrows anything else — a
/// permission error is a real problem and should not read as "not installed".
#[tauri::command]
pub async fn path_exists(file_path: String) -> Result<bool, String> {
    if file_path.is_empty() {
        return Ok(false);
    }

    match tokio::fs::metadata(&file_path).await {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("{file_path}: {e}")),
    }
}

/// Port of `readdir` (app/ipc-events.ts:289) — names only, not paths, as `fsp.readdir` gives.
#[tauri::command]
pub async fn readdir(dir_path: String) -> Result<Vec<String>, String> {
    let mut entries = tokio::fs::read_dir(&dir_path)
        .await
        .map_err(|e| format!("{dir_path}: {e}"))?;

    let mut names = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("{dir_path}: {e}"))?
    {
        names.push(entry.file_name().to_string_lossy().into_owned());
    }

    // fs.readdir gives no ordering guarantee either, but a stable one makes the addon scan
    // reproducible run to run, which matters when diffing scan results against Electron's.
    names.sort();
    Ok(names)
}

/// Port of `read-file` (app/ipc-events.ts:469) — UTF-8 text.
///
/// This is how every `.toc` file is read during an addon scan, so it runs hundreds of times
/// per installation.
#[tauri::command]
pub async fn read_file(file_path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("{file_path}: {e}"))
}

/// Port of `read-file-buffer` (app/ipc-events.ts:473).
///
/// Returns raw bytes. Tauri's IPC is JSON, so a Vec<u8> crosses as an array of numbers —
/// which is what the renderer's `Buffer`-shaped consumers already index into.
#[tauri::command]
pub async fn read_file_buffer(file_path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("{file_path}: {e}"))
}

/// Port of `list-directories` (app/ipc-events.ts:305), minus symlink scanning.
///
/// `scan_symlinks` is accepted and ignored for now: the Electron version resolves symlinked
/// addon directories, which matters for `use_symlink_mode` installs. Wiring that needs the
/// same `getSymlinkDirs` walk and belongs with the rest of Group A rather than smuggled in
/// here — but the parameter stays so the channel signature does not change later.
#[tauri::command]
pub async fn list_directories(
    file_path: String,
    scan_symlinks: Option<bool>,
) -> Result<Vec<String>, String> {
    if scan_symlinks == Some(true) {
        log::warn!("[files] symlink scanning is not implemented yet; listing directories only");
    }

    let mut entries = tokio::fs::read_dir(&file_path)
        .await
        .map_err(|e| format!("{file_path}: {e}"))?;

    let mut names = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("{file_path}: {e}"))?
    {
        // `withFileTypes` + isDirectory() in the JS. `file_type()` does not follow symlinks,
        // matching Dirent.
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }

    names.sort();
    Ok(names)
}

/// Port of `get-latest-dir-update-time` (app/ipc-events.ts:490 -> file.utils.ts:230).
///
/// The newest mtime anywhere under `dir_path`, in milliseconds. The renderer compares it
/// against a stored value to decide whether an installation's addon folder changed since
/// the last scan, so returning something too new means rescanning every launch and
/// something too old means never noticing an addon was added by hand.
///
/// The JS walks recursively and stats every file. Same here, iteratively rather than
/// recursively — an AddOns directory is wide and a deep recursion over it is avoidable.
#[tauri::command]
pub async fn get_latest_dir_update_time(dir_path: String) -> Result<f64, String> {
    let mut latest: f64 = 0.0;
    let mut stack = vec![std::path::PathBuf::from(&dir_path)];

    while let Some(dir) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            // A directory that vanished mid-walk, or one we cannot read, should not fail the
            // whole call: the JS would reject, and the renderer treats a rejection as "scan
            // needed", which is the safe direction but noisy.
            Err(e) => {
                log::warn!("[files] skipping {}: {e}", dir.display());
                continue;
            }
        };

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
                continue;
            }
            if let Ok(modified) = meta.modified() {
                if let Ok(since) = modified.duration_since(std::time::UNIX_EPOCH) {
                    // Milliseconds, matching Node's stat.mtimeMs.
                    latest = latest.max(since.as_secs_f64() * 1000.0);
                }
            }
        }
    }

    Ok(latest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_empty_path_is_not_an_error() {
        // getAddonFolderPath can produce "" for an installation with no location yet.
        assert_eq!(path_exists(String::new()).await.unwrap(), false);
    }

    #[tokio::test]
    async fn a_missing_path_is_false_rather_than_an_error() {
        assert_eq!(
            path_exists("/nonexistent/wow/_retail_".into()).await.unwrap(),
            false
        );
    }

    #[tokio::test]
    async fn an_existing_directory_is_true() {
        let dir = std::env::temp_dir();
        assert!(path_exists(dir.to_string_lossy().into_owned()).await.unwrap());
    }

    #[tokio::test]
    async fn readdir_lists_names_sorted() {
        let dir = std::env::temp_dir().join("wowup-readdir-test");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        tokio::fs::create_dir_all(&dir).await.unwrap();
        for name in ["WeakAuras", "DBM-Core", "Details"] {
            tokio::fs::create_dir_all(dir.join(name)).await.unwrap();
        }

        let names = readdir(dir.to_string_lossy().into_owned()).await.unwrap();
        assert_eq!(names, vec!["DBM-Core", "Details", "WeakAuras"]);
    }

    #[tokio::test]
    async fn read_file_round_trips_utf8() {
        let path = std::env::temp_dir().join("wowup-read-file-test.toc");
        tokio::fs::write(&path, "## Title: Déjà Vu\n").await.unwrap();
        let text = read_file(path.to_string_lossy().into_owned()).await.unwrap();
        assert_eq!(text, "## Title: Déjà Vu\n");
    }

    #[tokio::test]
    async fn read_file_reports_the_path_it_failed_on() {
        // A scan reads hundreds of files; "No such file" alone names none of them.
        let err = read_file("/nonexistent/WeakAuras.toc".into()).await.unwrap_err();
        assert!(err.contains("WeakAuras.toc"), "got {err}");
    }

    #[tokio::test]
    async fn list_directories_excludes_files() {
        let dir = std::env::temp_dir().join("wowup-listdirs-test");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        tokio::fs::create_dir_all(dir.join("WeakAuras")).await.unwrap();
        tokio::fs::create_dir_all(dir.join("DBM-Core")).await.unwrap();
        tokio::fs::write(dir.join("notes.txt"), "x").await.unwrap();

        let dirs = list_directories(dir.to_string_lossy().into_owned(), Some(false))
            .await
            .unwrap();
        assert_eq!(dirs, vec!["DBM-Core", "WeakAuras"]);
    }

    #[tokio::test]
    async fn latest_update_time_finds_the_newest_file_at_any_depth() {
        let dir = std::env::temp_dir().join("wowup-mtime-test");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        tokio::fs::create_dir_all(dir.join("WeakAuras/Sub")).await.unwrap();
        tokio::fs::write(dir.join("WeakAuras/a.toc"), "x").await.unwrap();
        tokio::fs::write(dir.join("WeakAuras/Sub/b.lua"), "y").await.unwrap();

        let t = get_latest_dir_update_time(dir.to_string_lossy().into_owned())
            .await
            .unwrap();

        // Milliseconds since the epoch, so far larger than seconds would be. A nested file
        // must count: addons keep most of their code below the top level.
        assert!(t > 1_600_000_000_000.0, "got {t}");
    }

    #[tokio::test]
    async fn latest_update_time_of_a_missing_directory_is_zero_not_an_error() {
        // The renderer asks about installations whose folder may not exist yet.
        assert_eq!(
            get_latest_dir_update_time("/nonexistent/AddOns".into()).await.unwrap(),
            0.0
        );
    }

    #[tokio::test]
    async fn readdir_on_a_missing_directory_reports_the_path() {
        let err = readdir("/nonexistent/AddOns".into()).await.unwrap_err();
        assert!(err.contains("/nonexistent/AddOns"), "got {err}");
    }
}
