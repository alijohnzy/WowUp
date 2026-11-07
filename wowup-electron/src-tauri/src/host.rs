//! Starting programs on the host from inside the AppImage.
//!
//! The AppImage's launcher exports variables that point into its own mount — `LD_LIBRARY_PATH`,
//! `PATH`, `PYTHONHOME`, `GIO_EXTRA_MODULES`, the GTK hook's `GTK_THEME`/`GDK_BACKEND` — and
//! every process the app starts inherits them. The CI AppImage bundles Ubuntu 22.04's
//! libreadline, so on a newer host the system's `bash` (and `/bin/sh` where that is bash)
//! loaded it and died: "bash: symbol lookup error: undefined symbol: rl_trim_arg_from_keyseq".
//! That broke the restart after an update (AppRun is a bash script) and every `xdg-open`
//! (a sh script) — links, folders, Report a Bug.
//!
//! The app itself needs those variables, so they are left alone; only the programs it starts
//! get an environment without them.

use std::ffi::{OsStr, OsString};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Manager};

/// Set by the AppImage launcher with no reference to the mount, so a value test misses them.
const LAUNCHER_ONLY: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "PYTHONDONTWRITEBYTECODE",
    // linuxdeploy-plugin-gtk sets these unconditionally; a browser started through xdg-open
    // would otherwise come up in Adwaita light, forced onto X11.
    "GTK_THEME",
    "GDK_BACKEND",
];

/// How to turn the app's environment into a host program's: `(name, None)` removes a
/// variable, `(name, Some(value))` replaces it. Path lists keep the entries that are not in
/// the mount, so anything the user had set survives. Empty when not inside an AppImage.
pub fn host_env_changes<I>(vars: I, appdir: Option<&OsStr>) -> Vec<(OsString, Option<OsString>)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let Some(appdir) = appdir.and_then(|a| a.to_str()).filter(|a| !a.is_empty()) else {
        return Vec::new();
    };
    let appdir = appdir.trim_end_matches('/');

    let mut changes = Vec::new();
    for (name, value) in vars {
        let name_str = name.to_string_lossy();
        if LAUNCHER_ONLY.contains(&name_str.as_ref()) {
            changes.push((name, None));
            continue;
        }
        let value_str = value.to_string_lossy();
        if !value_str.contains(appdir) {
            continue;
        }
        let kept: Vec<&str> = value_str
            .split(':')
            .filter(|entry| !entry.is_empty() && !entry.starts_with(appdir))
            .collect();
        if kept.is_empty() {
            changes.push((name, None));
        } else {
            changes.push((name, Some(OsString::from(kept.join(":")))));
        }
    }
    changes
}

/// A `Command` for a host program, with the AppImage's variables taken out.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    for (name, value) in
        host_env_changes(std::env::vars_os(), std::env::var_os("APPDIR").as_deref())
    {
        match value {
            Some(v) => cmd.env(name, v),
            None => cmd.env_remove(name),
        };
    }
    cmd
}

/// The AppImage file this process runs from, or `None` when it does not.
///
/// APPIMAGE and APPDIR alone are not enough: every program started from an AppImage inherits
/// them. A copy of this app launched from inside another AppImage (a terminal, an IDE) saw
/// that one's variables, and its restart started the *other* AppImage. So the executable
/// must also live inside APPDIR, the mount the launcher set up for it.
pub fn appimage_path() -> Option<OsString> {
    let appimage = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty())?;
    let appdir = std::env::var_os("APPDIR").filter(|v| !v.is_empty())?;
    let exe = std::env::current_exe().ok()?;
    exe_inside(&exe, std::path::Path::new(&appdir)).then_some(appimage)
}

/// Whether `exe` is inside `dir`, comparing real paths where they resolve.
pub fn exe_inside(exe: &std::path::Path, dir: &std::path::Path) -> bool {
    let real = |p: &std::path::Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    real(exe).starts_with(real(dir))
}

/// Whether this process runs from an AppImage of its own (see `appimage_path`).
pub fn in_appimage() -> bool {
    appimage_path().is_some()
}

/// Open a URL or path with the desktop's handler, outside the AppImage's environment.
/// Detached: xdg-open can wait on the handler, and nothing here needs the result beyond a log.
pub fn open_detached(target: &str) -> Result<(), String> {
    let mut child = command("xdg-open")
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("xdg-open {target}: {e}"))?;
    let target = target.to_string();
    std::thread::spawn(move || match child.wait() {
        Ok(status) if !status.success() => log::warn!("xdg-open {target} exited with {status}"),
        Err(e) => log::warn!("xdg-open {target}: {e}"),
        _ => {}
    });
    Ok(())
}

/// Restart the app. From an AppImage this starts the AppImage file again — the new version, if
/// the updater just replaced it — with the host environment; Tauri's own `restart` would pass
/// the old mount's variables to the next launcher. Elsewhere it is Tauri's `restart`.
pub fn relaunch(app: &AppHandle) {
    app.state::<crate::window::Quitting>().set();
    // The new copy starts while this one is still running. Holding the single-instance lock,
    // this copy would look like the one to hand over to: the new copy would focus it and exit,
    // and then this one exits too, leaving nothing running.
    tauri_plugin_single_instance::destroy(app);

    {
        if let Some(appimage) = appimage_path() {
            let args: Vec<OsString> = std::env::args_os().skip(1).collect();
            match command(&appimage).args(&args).stdin(Stdio::null()).spawn() {
                Ok(_) => {
                    log::info!("relaunching {}", appimage.to_string_lossy());
                    app.exit(0);
                    return;
                }
                Err(e) => {
                    log::error!("could not relaunch the AppImage: {e}; using Tauri's restart")
                }
            }
        }
    }
    app.restart();
}

/// Port of `shell.openExternal` for the renderer's links. Replaces the opener plugin's
/// `openUrl`, which inside the AppImage started xdg-open with the mount's environment.
/// Limited to the schemes the plugin's default scope allowed.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !allowed_url(&url) {
        return Err(format!("refusing to open {url}"));
    }
    if in_appimage() {
        open_detached(&url)
    } else {
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| e.to_string())
    }
}

/// Web pages and mail links only: a page in the app must not be able to open local files or
/// arbitrary URI handlers through this.
pub fn allowed_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https" | "mailto"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(k, v)| (OsString::from(k), OsString::from(v)))
            .collect()
    }

    fn change<'a>(
        changes: &'a [(OsString, Option<OsString>)],
        name: &str,
    ) -> Option<&'a Option<OsString>> {
        changes.iter().find(|(n, _)| n == name).map(|(_, v)| v)
    }

    const MOUNT: &str = "/tmp/.mount_WowUp-oFmIEa";

    #[test]
    fn only_web_and_mail_links_open() {
        assert!(allowed_url(
            "https://github.com/alijohnzy/WowUpNight/issues/new?body=x"
        ));
        assert!(allowed_url("http://example.com"));
        assert!(allowed_url("mailto:someone@example.com"));
        assert!(!allowed_url("file:///etc/passwd"));
        assert!(!allowed_url("javascript:alert(1)"));
        assert!(!allowed_url("steam://run/1"));
        assert!(!allowed_url("not a url"));
    }

    #[test]
    fn only_an_executable_inside_the_mount_counts_as_the_appimage() {
        let mount = std::path::Path::new("/tmp/.mount_WowUpN-x1");
        assert!(exe_inside(&mount.join("usr/bin/wowup"), mount));
        // A copy started from another AppImage inherits its APPDIR but lives elsewhere.
        assert!(!exe_inside(std::path::Path::new("/usr/bin/wowup"), mount));
        assert!(!exe_inside(
            std::path::Path::new("/tmp/.mount_WowUpN-x1-other/usr/bin/wowup"),
            mount
        ));
    }

    #[test]
    fn nothing_changes_outside_an_appimage() {
        let vars = env(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_x/usr/lib/"),
            ("GTK_THEME", "Adwaita"),
        ]);
        assert!(host_env_changes(vars.clone(), None).is_empty());
        assert!(host_env_changes(vars, Some(OsStr::new(""))).is_empty());
    }

    #[test]
    fn path_lists_lose_only_the_mount() {
        let vars = env(&[
            (
                "LD_LIBRARY_PATH",
                &format!("{MOUNT}/usr/lib/:{MOUNT}/usr/lib/x86_64-linux-gnu/:/opt/mine/lib"),
            ),
            ("PATH", &format!("{MOUNT}/usr/bin/:/usr/local/bin:/usr/bin")),
            ("XDG_DATA_DIRS", &format!("{MOUNT}/usr/share:/usr/share")),
            ("PYTHONPATH", &format!("{MOUNT}/usr/share/pyshared/:")),
        ]);
        let changes = host_env_changes(vars, Some(OsStr::new(MOUNT)));
        assert_eq!(
            change(&changes, "LD_LIBRARY_PATH"),
            Some(&Some("/opt/mine/lib".into()))
        );
        assert_eq!(
            change(&changes, "PATH"),
            Some(&Some("/usr/local/bin:/usr/bin".into()))
        );
        assert_eq!(
            change(&changes, "XDG_DATA_DIRS"),
            Some(&Some("/usr/share".into()))
        );
        // Only the mount and an empty entry: nothing of the user's to keep.
        assert_eq!(change(&changes, "PYTHONPATH"), Some(&None));
    }

    #[test]
    fn launcher_variables_go_and_others_stay() {
        let vars = env(&[
            ("PYTHONHOME", &format!("{MOUNT}/usr/")),
            (
                "GDK_PIXBUF_MODULE_FILE",
                &format!("{MOUNT}//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"),
            ),
            ("APPDIR", MOUNT),
            ("APPIMAGE", "/home/u/Applications/WowUp.AppImage"),
            ("GTK_THEME", "Adwaita:light"),
            ("GDK_BACKEND", "x11"),
            ("HOME", "/home/u"),
            ("DISPLAY", ":0"),
        ]);
        let changes = host_env_changes(vars, Some(OsStr::new(&format!("{MOUNT}/"))));
        for gone in [
            "PYTHONHOME",
            "GDK_PIXBUF_MODULE_FILE",
            "APPDIR",
            "APPIMAGE",
            "GTK_THEME",
            "GDK_BACKEND",
        ] {
            assert_eq!(
                change(&changes, gone),
                Some(&None),
                "{gone} should be removed"
            );
        }
        assert_eq!(change(&changes, "HOME"), None);
        assert_eq!(change(&changes, "DISPLAY"), None);
    }

    /// The failure itself, against a real extracted AppImage: point WOWUP_TEST_APPDIR at a
    /// `squashfs-root` that bundles an older libreadline than the host's and run with
    /// `--ignored`. With the AppImage's LD_LIBRARY_PATH the host's bash dies with a symbol
    /// lookup error; through `command` it runs.
    #[test]
    #[ignore]
    fn host_bash_runs_despite_the_bundled_libreadline() {
        let Some(appdir) = std::env::var_os("WOWUP_TEST_APPDIR") else {
            panic!("set WOWUP_TEST_APPDIR to an extracted AppImage's squashfs-root");
        };
        let lib = format!("{}/usr/lib/", appdir.to_string_lossy());

        let broken = Command::new("bash")
            .args(["-c", "echo ok"])
            .env("LD_LIBRARY_PATH", &lib)
            .output()
            .unwrap();
        assert!(
            !broken.status.success(),
            "precondition: the bundled readline should break bash"
        );

        let mut cmd = Command::new("bash");
        cmd.args(["-c", "echo ok"]).env("LD_LIBRARY_PATH", &lib);
        let vars = env(&[("LD_LIBRARY_PATH", &lib)]);
        for (name, value) in host_env_changes(vars, Some(&appdir)) {
            match value {
                Some(v) => cmd.env(name, v),
                None => cmd.env_remove(name),
            };
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "ok");
    }
}
