use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    // The commit this build is made from, for the footer: local builds carry no CI build
    // number to tell them apart. Empty when git is unavailable, e.g. in a source tarball.
    let commit = git(&["rev-parse", "--short=8", "HEAD"]).unwrap_or_default();
    println!("cargo:rustc-env=WOWUP_BUILD_COMMIT={commit}");
    // Rebuild the value when HEAD moves: a commit updates the branch ref, a checkout HEAD.
    if let Some(dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        for path in ["HEAD", "refs/heads", "packed-refs"] {
            println!("cargo:rerun-if-changed={dir}/{path}");
        }
    }

    tauri_build::build()
}
