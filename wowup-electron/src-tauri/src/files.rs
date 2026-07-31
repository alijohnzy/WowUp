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
            path_exists("/nonexistent/wow/_retail_".into())
                .await
                .unwrap(),
            false
        );
    }

    #[tokio::test]
    async fn an_existing_directory_is_true() {
        let dir = std::env::temp_dir();
        assert!(path_exists(dir.to_string_lossy().into_owned())
            .await
            .unwrap());
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
        tokio::fs::write(&path, "## Title: Déjà Vu\n")
            .await
            .unwrap();
        let text = read_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(text, "## Title: Déjà Vu\n");
    }

    #[tokio::test]
    async fn read_file_reports_the_path_it_failed_on() {
        // A scan reads hundreds of files; "No such file" alone names none of them.
        let err = read_file("/nonexistent/WeakAuras.toc".into())
            .await
            .unwrap_err();
        assert!(err.contains("WeakAuras.toc"), "got {err}");
    }

    #[tokio::test]
    async fn list_directories_excludes_files() {
        let dir = std::env::temp_dir().join("wowup-listdirs-test");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        tokio::fs::create_dir_all(dir.join("WeakAuras"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(dir.join("DBM-Core"))
            .await
            .unwrap();
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
        tokio::fs::create_dir_all(dir.join("WeakAuras/Sub"))
            .await
            .unwrap();
        tokio::fs::write(dir.join("WeakAuras/a.toc"), "x")
            .await
            .unwrap();
        tokio::fs::write(dir.join("WeakAuras/Sub/b.lua"), "y")
            .await
            .unwrap();

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
            get_latest_dir_update_time("/nonexistent/AddOns".into())
                .await
                .unwrap(),
            0.0
        );
    }

    #[tokio::test]
    async fn readdir_on_a_missing_directory_reports_the_path() {
        let err = readdir("/nonexistent/AddOns".into()).await.unwrap_err();
        assert!(err.contains("/nonexistent/AddOns"), "got {err}");
    }
}

// ---------------------------------------------------------------------------
// Mutating operations and metadata — the rest of Group A that install/remove needs.
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// `fsp.mkdir(path, { recursive: true })` — port of `create-directory`.
#[tauri::command]
pub async fn create_directory(directory_path: String) -> Result<bool, String> {
    log::info!("[CreateDirectory] '{directory_path}'");
    tokio::fs::create_dir_all(&directory_path)
        .await
        .map_err(|e| format!("{directory_path}: {e}"))?;
    Ok(true)
}

/// Port of `delete-directory`, which removes a file *or* a directory tree.
///
/// Named for directories but used for both — addon removal deletes folders, and the
/// download path deletes single files.
#[tauri::command]
pub async fn delete_directory(file_path: String) -> Result<bool, String> {
    log::info!("[FileRemove] {file_path}");

    let meta = match tokio::fs::symlink_metadata(&file_path).await {
        Ok(m) => m,
        // Already gone is success: removal is idempotent in the JS too (`remove` swallows
        // ENOENT), and failing here would block an addon uninstall that half-completed.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(true),
        Err(e) => return Err(format!("{file_path}: {e}")),
    };

    // symlink_metadata, so a symlinked addon folder is unlinked rather than followed and
    // its target deleted.
    let result = if meta.is_dir() && !meta.is_symlink() {
        tokio::fs::remove_dir_all(&file_path).await
    } else {
        tokio::fs::remove_file(&file_path).await
    };

    result.map_err(|e| format!("{file_path}: {e}"))?;
    Ok(true)
}

/// Port of `write-file` — UTF-8 text.
#[tauri::command]
pub async fn write_file(file_path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(&file_path, contents)
        .await
        .map_err(|e| format!("{file_path}: {e}"))
}

/// Mirrors `CopyFileRequest` (src/common/models/copy-file-request.ts).
///
/// The renderer invokes copy-file with one object rather than positional arguments, so this
/// takes the object. `destinationFileChmod` is accepted and ignored: it exists because the
/// Electron path chmod'd the copy, which matters on Unix for files extracted from a zip —
/// worth doing when unzip lands, not before.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFileRequest {
    pub source_file_path: String,
    pub destination_file_path: String,
}

/// Port of `copy-file`, which copies a file or recursively copies a directory.
#[tauri::command]
pub async fn copy_file(request: CopyFileRequest) -> Result<bool, String> {
    let CopyFileRequest {
        source_file_path,
        destination_file_path,
    } = request;
    log::info!("[FileCopy] '{source_file_path}' -> '{destination_file_path}'");

    let meta = tokio::fs::symlink_metadata(&source_file_path)
        .await
        .map_err(|e| format!("{source_file_path}: {e}"))?;

    if meta.is_dir() {
        copy_dir_recursive(&source_file_path, &destination_file_path).await?;
    } else {
        if let Some(parent) = std::path::Path::new(&destination_file_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        tokio::fs::copy(&source_file_path, &destination_file_path)
            .await
            .map_err(|e| format!("{source_file_path} -> {destination_file_path}: {e}"))?;
    }
    Ok(true)
}

/// Iterative rather than recursive: `async fn` cannot recurse without boxing, and an addon
/// tree is arbitrarily deep.
async fn copy_dir_recursive(from: &str, to: &str) -> Result<(), String> {
    let mut stack = vec![(std::path::PathBuf::from(from), std::path::PathBuf::from(to))];

    while let Some((src, dst)) = stack.pop() {
        tokio::fs::create_dir_all(&dst)
            .await
            .map_err(|e| format!("{}: {e}", dst.display()))?;

        let mut entries = tokio::fs::read_dir(&src)
            .await
            .map_err(|e| format!("{}: {e}", src.display()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("{}: {e}", src.display()))?
        {
            let target = dst.join(entry.file_name());
            let ty = entry
                .file_type()
                .await
                .map_err(|e| format!("{}: {e}", entry.path().display()))?;

            if ty.is_dir() {
                stack.push((entry.path(), target));
            } else {
                tokio::fs::copy(entry.path(), &target)
                    .await
                    .map_err(|e| format!("{}: {e}", entry.path().display()))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    // `os.homedir()`. Reading the env directly rather than via a path API, because the JS
    // did and WoW paths are stored relative to whatever it returned.
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");

    home.map(|h| h.to_string_lossy().into_owned())
        .ok_or_else(|| "no home directory in the environment".to_string())
}

/// Port of `show-directory` — `shell.openPath`, i.e. reveal in the file manager.
#[tauri::command]
pub async fn show_directory(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    match app.opener().open_path(&file_path, None::<&str>) {
        Ok(()) => Ok(String::new()),
        // shell.openPath resolves to an error *string* rather than rejecting.
        Err(e) => Ok(e.to_string()),
    }
}

/// Mirrors `FsStats` (wowup-lib/src/ipc.ts:1).
///
/// The `Date` fields cross as ISO strings: Tauri's IPC is JSON, so a real Date cannot
/// survive, and `new Date(string)` is what the renderer does with them anyway.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStats {
    pub is_file: bool,
    pub is_directory: bool,
    pub is_block_device: bool,
    pub is_character_device: bool,
    pub is_symbolic_link: bool,
    #[serde(rename = "isFIFO")]
    pub is_fifo: bool,
    pub is_socket: bool,
    pub dev: u64,
    pub ino: u64,
    pub mode: u32,
    pub nlink: u64,
    pub uid: u32,
    pub gid: u32,
    pub rdev: u64,
    pub size: u64,
    pub blksize: u64,
    pub blocks: u64,
    pub atime_ms: f64,
    pub mtime_ms: f64,
    pub ctime_ms: f64,
    pub birthtime_ms: f64,
}

fn to_millis(t: std::io::Result<std::time::SystemTime>) -> f64 {
    t.ok()
        .and_then(|s| s.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Port of `stat-files` — a map of path -> stats.
#[tauri::command]
pub async fn stat_files(
    file_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, FsStats>, String> {
    let mut out = std::collections::HashMap::new();

    for path in file_paths {
        // `fsp.stat` follows symlinks, so a symlinked addon folder reports as a directory.
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| format!("{path}: {e}"))?;
        let link_meta = tokio::fs::symlink_metadata(&path).await.ok();

        #[cfg(unix)]
        let stats = {
            use std::os::unix::fs::{FileTypeExt, MetadataExt};
            FsStats {
                is_file: meta.is_file(),
                is_directory: meta.is_dir(),
                is_block_device: meta.file_type().is_block_device(),
                is_character_device: meta.file_type().is_char_device(),
                is_symbolic_link: link_meta.map(|m| m.is_symlink()).unwrap_or(false),
                is_fifo: meta.file_type().is_fifo(),
                is_socket: meta.file_type().is_socket(),
                dev: meta.dev(),
                ino: meta.ino(),
                mode: meta.mode(),
                nlink: meta.nlink(),
                uid: meta.uid(),
                gid: meta.gid(),
                rdev: meta.rdev(),
                size: meta.size(),
                blksize: meta.blksize(),
                blocks: meta.blocks(),
                atime_ms: to_millis(meta.accessed()),
                mtime_ms: to_millis(meta.modified()),
                ctime_ms: meta.ctime() as f64 * 1000.0,
                birthtime_ms: to_millis(meta.created()),
            }
        };

        #[cfg(not(unix))]
        let stats = FsStats {
            is_file: meta.is_file(),
            is_directory: meta.is_dir(),
            is_block_device: false,
            is_character_device: false,
            is_symbolic_link: link_meta.map(|m| m.is_symlink()).unwrap_or(false),
            is_fifo: false,
            is_socket: false,
            dev: 0,
            ino: 0,
            mode: 0,
            nlink: 0,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: meta.len(),
            blksize: 0,
            blocks: 0,
            atime_ms: to_millis(meta.accessed()),
            mtime_ms: to_millis(meta.modified()),
            ctime_ms: to_millis(meta.modified()),
            birthtime_ms: to_millis(meta.created()),
        };

        out.insert(path, stats);
    }

    Ok(out)
}

/// `globrex(filter)` in the JS — a shell glob, matched against the entry *name*.
pub(crate) fn glob_matcher(filter: &str) -> Result<globset::GlobMatcher, String> {
    globset::Glob::new(filter)
        .map_err(|e| format!("bad filter {filter:?}: {e}"))
        .map(|g| g.compile_matcher())
}

/// Port of `list-files` — names in `source_path` matching `filter`.
///
/// A missing directory yields an empty list rather than an error, as in the JS: the caller
/// asks about addon folders that may not exist.
#[tauri::command]
pub async fn list_files(source_path: String, filter: String) -> Result<Vec<String>, String> {
    if !path_exists(source_path.clone()).await? {
        return Ok(Vec::new());
    }

    let matcher = glob_matcher(&filter)?;
    let mut entries = tokio::fs::read_dir(&source_path)
        .await
        .map_err(|e| format!("{source_path}: {e}"))?;

    let mut names = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("{source_path}: {e}"))?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if matcher.is_match(&name) {
            names.push(name);
        }
    }

    names.sort();
    Ok(names)
}

/// Mirrors `FsDirent` (src/common/models/ipc-events.ts).
///
/// Node's `Dirent` answers seven `isX()` questions and the renderer reads several of them, so
/// the shape is reproduced rather than trimmed to the two that are usually interesting.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirent {
    is_file: bool,
    is_directory: bool,
    is_block_device: bool,
    is_character_device: bool,
    is_symbolic_link: bool,
    #[serde(rename = "isFIFO")]
    is_fifo: bool,
    is_socket: bool,
    name: String,
}

/// Port of `IPC_LIST_ENTRIES` (app/ipc-events.ts:333).
///
/// The type flags come from the entry's own `file_type()`, which — like Node's `Dirent` — is
/// the *link's* type, so a symlink reports `is_symbolic_link` and not what it points at.
#[tauri::command]
pub async fn list_entries(source_path: String, filter: String) -> Result<Vec<FsDirent>, String> {
    let matcher = glob_matcher(&filter)?;
    let mut entries = tokio::fs::read_dir(&source_path)
        .await
        .map_err(|e| format!("{source_path}: {e}"))?;

    let mut out = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("{source_path}: {e}"))?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !matcher.is_match(&name) {
            continue;
        }

        let ft = entry
            .file_type()
            .await
            .map_err(|e| format!("{name}: {e}"))?;

        #[cfg(unix)]
        let (block, char_dev, fifo, socket) = {
            use std::os::unix::fs::FileTypeExt;
            (
                ft.is_block_device(),
                ft.is_char_device(),
                ft.is_fifo(),
                ft.is_socket(),
            )
        };
        #[cfg(not(unix))]
        let (block, char_dev, fifo, socket) = (false, false, false, false);

        out.push(FsDirent {
            is_file: ft.is_file(),
            is_directory: ft.is_dir(),
            is_block_device: block,
            is_character_device: char_dev,
            is_symbolic_link: ft.is_symlink(),
            is_fifo: fifo,
            is_socket: socket,
            name,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Port of `readDirRecursive` (app/file.utils.ts:146). Files only, directories are descended.
///
/// A symlinked root is resolved first, matching the original — the WTF folder is a symlink on
/// some installs, and without this the walk would return nothing for it.
#[tauri::command]
pub async fn list_dir_recursive(dir_path: String) -> Result<Vec<String>, String> {
    let root = resolve_link(&dir_path).await?;
    let mut out = Vec::new();
    walk_files(&root, &mut out).await?;
    Ok(out)
}

async fn resolve_link(path: &str) -> Result<PathBuf, String> {
    let meta = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|e| format!("{path}: {e}"))?;
    if meta.file_type().is_symlink() {
        return tokio::fs::read_link(path)
            .await
            .map_err(|e| format!("{path}: {e}"));
    }
    Ok(PathBuf::from(path))
}

/// Boxed because the recursion is async: an `async fn` that awaits itself needs an
/// indirection or the future would be infinitely sized.
fn walk_files<'a>(
    dir: &'a Path,
    out: &'a mut Vec<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| format!("{}: {e}", dir.display()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("{}: {e}", dir.display()))?
        {
            let path = entry.path();
            let ft = entry
                .file_type()
                .await
                .map_err(|e| format!("{}: {e}", path.display()))?;

            if ft.is_dir() {
                walk_files(&path, out).await?;
            } else {
                out.push(path.to_string_lossy().into_owned());
            }
        }
        Ok(())
    })
}

/// Mirrors `TreeNode` (src/common/models/ipc-events.ts:12).
#[derive(Debug, Serialize)]
pub struct TreeNode {
    name: String,
    path: String,
    is_directory: bool,
    children: Vec<TreeNode>,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryTreeOptions {
    #[serde(default)]
    include_hash: bool,
}

/// Port of `getDirTree` (app/file.utils.ts:170), used by the WTF explorer.
#[tauri::command]
pub async fn get_directory_tree(
    dir_path: String,
    opts: Option<DirectoryTreeOptions>,
) -> Result<TreeNode, String> {
    let opts = opts.unwrap_or_default();
    let root = resolve_link(&dir_path).await?;

    let meta = tokio::fs::symlink_metadata(&root)
        .await
        .map_err(|e| format!("{}: {e}", root.display()))?;
    if !meta.is_dir() {
        // Same message as the original, which the renderer surfaces verbatim.
        return Err(format!(
            "getDirTree path was not a directory: {}",
            root.display()
        ));
    }

    build_tree(&root, opts.include_hash).await
}

fn build_tree<'a>(
    dir: &'a Path,
    include_hash: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TreeNode, String>> + Send + 'a>> {
    Box::pin(async move {
        let mut node = TreeNode {
            name: dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: dir.to_string_lossy().into_owned(),
            is_directory: true,
            children: Vec::new(),
            size: 0,
            hash: None,
        };

        let mut entries = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| format!("{}: {e}", dir.display()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("{}: {e}", dir.display()))?
        {
            let path = entry.path();
            let ft = entry
                .file_type()
                .await
                .map_err(|e| format!("{}: {e}", path.display()))?;

            if ft.is_dir() {
                let child = build_tree(&path, include_hash).await?;
                node.size += child.size;
                node.children.push(child);
            } else {
                let size = tokio::fs::metadata(&path)
                    .await
                    .map_err(|e| format!("{}: {e}", path.display()))?
                    .len();
                node.size += size;
                node.children.push(TreeNode {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    is_directory: false,
                    children: Vec::new(),
                    size,
                    hash: if include_hash {
                        Some(sha256_file(&path).await?)
                    } else {
                        Some(String::new())
                    },
                });
            }
        }

        if include_hash {
            // The original hashes the concatenation of the children's hashes, so a directory's
            // hash changes when any descendant does.
            let joined: String = node
                .children
                .iter()
                .map(|c| c.hash.clone().unwrap_or_default())
                .collect();
            node.hash = Some(sha256_string(&joined));
        }

        Ok(node)
    })
}

async fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(sha256_bytes(&bytes))
}

fn sha256_string(value: &str) -> String {
    sha256_bytes(value.as_bytes())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Port of `rename-file` (app/ipc-events.ts:436).
#[tauri::command]
pub async fn rename_file(src_path: String, dest_path: String) -> Result<(), String> {
    log::info!("[RenameFile]: '{src_path} -> {dest_path}");
    tokio::fs::rename(&src_path, &dest_path)
        .await
        .map_err(|e| format!("{src_path} -> {dest_path}: {e}"))
}

/// Port of `show-item-in-folder` (app/ipc-events.ts:255) — opens the file manager with the
/// item selected, rather than opening the item itself.
#[tauri::command]
pub fn show_item_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("{path}: {e}"))
}

/// Mirrors the subset of Electron's `OpenDialogOptions` the renderer sends.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogOptions {
    #[serde(default)]
    pub properties: Vec<String>,
    #[serde(default)]
    pub filters: Vec<DialogFilter>,
}

#[derive(Debug, Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Mirrors Electron's `OpenDialogReturnValue`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogReturnValue {
    pub canceled: bool,
    pub file_paths: Vec<String>,
}

/// Port of `IPC_SHOW_OPEN_DIALOG` (app/ipc-events.ts:566) — how a WoW install is added by hand
/// when the Blizzard agent's product.db does not list it.
///
/// Blocking rather than the async builder: Electron's dialog resolves once, and the renderer
/// awaits it before doing anything else.
#[tauri::command]
pub async fn show_open_dialog(
    app: tauri::AppHandle,
    options: Option<OpenDialogOptions>,
) -> Result<OpenDialogReturnValue, String> {
    use tauri_plugin_dialog::DialogExt;

    let options = options.unwrap_or_default();
    let directory = options.properties.iter().any(|p| p == "openDirectory");
    let multiple = options.properties.iter().any(|p| p == "multiSelections");

    let mut builder = app.dialog().file();
    for filter in &options.filters {
        let exts: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&filter.name, &exts);
    }

    // `blocking_*` would deadlock the async runtime, so this hops to a blocking thread.
    let paths = tauri::async_runtime::spawn_blocking(move || match (directory, multiple) {
        (true, true) => builder
            .blocking_pick_folders()
            .map(|v| v.into_iter().collect::<Vec<_>>()),
        (true, false) => builder.blocking_pick_folder().map(|p| vec![p]),
        (false, true) => builder
            .blocking_pick_files()
            .map(|v| v.into_iter().collect::<Vec<_>>()),
        (false, false) => builder.blocking_pick_file().map(|p| vec![p]),
    })
    .await
    .map_err(|e| format!("dialog panicked: {e}"))?;

    Ok(match paths {
        // `canceled` is what the renderer checks first; an empty list with canceled=false
        // would read as "picked nothing" and take the success path.
        None => OpenDialogReturnValue {
            canceled: true,
            file_paths: Vec::new(),
        },
        Some(paths) => OpenDialogReturnValue {
            canceled: false,
            file_paths: paths.into_iter().map(|p| p.to_string()).collect(),
        },
    })
}

#[cfg(test)]
mod fs_group_tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wowup-fs-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The renderer reads `isDirectory` off these to split folders from files, so the flags
    /// have to describe the entry rather than always coming back false.
    #[tokio::test]
    async fn list_entries_reports_type_flags_and_filters() {
        let dir = tmpdir("entries");
        std::fs::write(dir.join("a.toc"), "x").unwrap();
        std::fs::write(dir.join("b.lua"), "x").unwrap();
        std::fs::create_dir(dir.join("sub")).unwrap();

        let all = list_entries(dir.to_string_lossy().into(), "*".into())
            .await
            .unwrap();
        assert_eq!(all.len(), 3);
        let sub = all.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_directory && !sub.is_file);
        let toc = all.iter().find(|e| e.name == "a.toc").unwrap();
        assert!(toc.is_file && !toc.is_directory);

        let tocs = list_entries(dir.to_string_lossy().into(), "*.toc".into())
            .await
            .unwrap();
        assert_eq!(tocs.len(), 1);
        assert_eq!(tocs[0].name, "a.toc");
    }

    /// Files only, and every level — the WTF walk depends on both.
    #[tokio::test]
    async fn list_dir_recursive_returns_files_at_every_level() {
        let dir = tmpdir("recursive");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("top.txt"), "x").unwrap();
        std::fs::write(dir.join("a/mid.txt"), "x").unwrap();
        std::fs::write(dir.join("a/b/deep.txt"), "x").unwrap();

        let mut found = list_dir_recursive(dir.to_string_lossy().into())
            .await
            .unwrap();
        found.sort();
        assert_eq!(found.len(), 3, "{found:?}");
        assert!(found.iter().all(|f| f.ends_with(".txt")));
        assert!(found.iter().any(|f| f.ends_with("deep.txt")));
    }

    /// Directory sizes are the sum of their descendants, which is what the WTF screen shows.
    #[tokio::test]
    async fn directory_tree_sums_sizes_and_nests() {
        let dir = tmpdir("tree");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("one.txt"), "12345").unwrap();
        std::fs::write(dir.join("sub/two.txt"), "123").unwrap();

        let tree = get_directory_tree(dir.to_string_lossy().into(), None)
            .await
            .unwrap();

        assert!(tree.is_directory);
        assert_eq!(tree.size, 8, "5 + 3 across both levels");
        let sub = tree.children.iter().find(|c| c.name == "sub").unwrap();
        assert_eq!(sub.size, 3);
        assert_eq!(sub.children.len(), 1);
    }

    /// A directory's hash is built from its children's, so any descendant changing changes it.
    #[tokio::test]
    async fn directory_tree_hash_follows_content() {
        let dir = tmpdir("tree-hash");
        std::fs::write(dir.join("f.txt"), "before").unwrap();
        let opts = Some(DirectoryTreeOptions { include_hash: true });

        let first = get_directory_tree(dir.to_string_lossy().into(), opts)
            .await
            .unwrap();
        std::fs::write(dir.join("f.txt"), "after").unwrap();
        let second = get_directory_tree(
            dir.to_string_lossy().into(),
            Some(DirectoryTreeOptions { include_hash: true }),
        )
        .await
        .unwrap();

        assert!(first.hash.is_some());
        assert_ne!(first.hash, second.hash);
    }

    /// Without `includeHash` the original still emits an empty string per file rather than
    /// omitting the field, and the renderer compares against "".
    #[tokio::test]
    async fn directory_tree_without_hash_is_cheap_but_shaped_the_same() {
        let dir = tmpdir("tree-nohash");
        std::fs::write(dir.join("f.txt"), "x").unwrap();

        let tree = get_directory_tree(dir.to_string_lossy().into(), None)
            .await
            .unwrap();
        assert_eq!(tree.children[0].hash.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn directory_tree_refuses_a_file() {
        let dir = tmpdir("tree-file");
        let file = dir.join("f.txt");
        std::fs::write(&file, "x").unwrap();

        let err = get_directory_tree(file.to_string_lossy().into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("was not a directory"), "{err}");
    }
}
