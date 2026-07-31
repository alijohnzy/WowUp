//! Addon folder scanners — port of `app/curse-folder-scanner.ts` and
//! `app/wowup-folder-scanner.ts`.
//!
//! This is what tells the app which version of an addon is actually on disk. Without it the
//! stored `installedVersion` never changes, so nothing is ever reported as updatable no
//! matter how well the provider sync works.
//!
//! The two scanners collect the same set of files and differ only in how they hash them:
//! CurseForge uses the fingerprint in `fingerprint.rs` (its server matches on that exact
//! number), WowUp uses md5. The collection logic is shared here rather than duplicated, as
//! it was in the JS, because it is the fiddly half.
//!
//! Fidelity notes, each of which changes the resulting fingerprint if got wrong:
//!
//! * Files are matched on the path **relative to the addon folder's parent**, lowercased —
//!   so `WeakAuras/WeakAuras.toc` matches but `WeakAuras/Other.toc` does not.
//! * The final list is sorted by lowercased path before hashing.
//! * The per-file hashes are sorted before concatenation — numerically for CurseForge,
//!   lexicographically for WowUp, because the JS sorted numbers and strings respectively.
//! * `.toc`/`.xml` includes are followed recursively, resolved case-insensitively through a
//!   map of every file in the folder. Addon authors are inconsistent about case and this is
//!   what makes Linux behave like Windows.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::fingerprint::compute_hash;

/// Characters the JS refuses to follow in an include directive.
/// `|` plus the C0 control range, minus NUL-through-BEL which are listed individually.
fn has_invalid_path_chars(s: &str) -> bool {
    s.chars().any(|c| c == '|' || (c as u32) < 0x20)
}

/// Mirrors `AddonScanResult` (wowup-lib/src/addons.ts:113).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonScanResult {
    pub source: String,
    pub file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_fingerprints: Option<Vec<String>>,
    pub fingerprint: String,
    pub fingerprint_num: u32,
    pub folder_name: String,
    pub path: String,
}

/// Port of `readDirRecursive` (file.utils.ts) — every file beneath `root`, following a
/// symlinked root once as the JS does.
fn read_dir_recursive(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let start = match std::fs::symlink_metadata(root) {
        Ok(meta) if meta.is_symlink() => std::fs::read_link(root)?,
        _ => root.to_path_buf(),
    };

    let mut out = Vec::new();
    let mut stack = vec![start];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    Ok(out)
}

/// `^([^/]+)[\\/]\1([-_](mainline|bcc|…))?\.toc$`, case-insensitive, hand-rolled.
///
/// The backreference is why this is not a plain glob: the `.toc` has to be named after its
/// own folder, optionally with a flavour suffix. `WeakAuras/WeakAuras-Mists.toc` counts,
/// `WeakAuras/Libs.toc` does not.
///
/// Input is already lowercased and relative to the addon folder's parent.
fn is_addon_toc(relative: &str) -> bool {
    const FLAVOURS: [&str; 9] = [
        "mainline", "bcc", "tbc", "classic", "vanilla", "wrath", "wotlkc", "cata", "mists",
    ];

    let mut parts = relative.splitn(2, ['/', '\\']);
    let (Some(folder), Some(file)) = (parts.next(), parts.next()) else {
        return false;
    };
    // `[^/]+` for the folder, and the file must be directly inside it.
    if folder.is_empty() || file.contains('/') || file.contains('\\') {
        return false;
    }
    let Some(stem) = file.strip_suffix(".toc") else {
        return false;
    };
    let Some(rest) = stem.strip_prefix(folder) else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    // `[-_]` then a known flavour. The JS Curse variant writes `[-|_]`, a character class
    // that also admits a literal `|` — kept out here because a `|` is an invalid path char
    // anyway, so no real file can reach this branch.
    let Some(flavour) = rest.strip_prefix('-').or_else(|| rest.strip_prefix('_')) else {
        return false;
    };
    FLAVOURS.contains(&flavour)
}

/// `^[^/\\]+[/\\]Bindings\.xml$`, case-insensitive. Input already lowercased.
fn is_bindings_xml(relative: &str) -> bool {
    let mut parts = relative.splitn(2, ['/', '\\']);
    match (parts.next(), parts.next()) {
        (Some(folder), Some(file)) => !folder.is_empty() && file == "bindings.xml",
        _ => false,
    }
}

/// Strips comments the way the JS regexes do, per extension.
fn remove_comments(path: &Path, content: &str) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
    {
        // `/\s*#.*$/gim` — a `#` to end of line, with any preceding whitespace.
        Some(ref ext) if ext == "toc" => content
            .lines()
            .map(|line| match line.find('#') {
                Some(i) => line[..i].trim_end(),
                None => line,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        // `/<!--.*?-->/gims` — non-greedy, spanning lines.
        Some(ref ext) if ext == "xml" => strip_xml_comments(content),
        _ => content.to_string(),
    }
}

fn strip_xml_comments(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        match rest[start..].find("-->") {
            Some(end) => rest = &rest[start + end + 3..],
            // Unterminated comment swallows the remainder, as the regex would.
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// Port of `ripMatch` — the deliberate quirk that makes fingerprints match CurseForge.
///
/// The JS splits content on `\n` **only**, trims each piece, and runs `exec` once per
/// piece, keeping just the first match. Its comment says why: it reproduces how .NET's
/// regex engine treats lines ending in `\r` versus `\r\n`, and CurseForge computes the
/// reference fingerprint with that same .NET code. Matching the quirk is what makes an
/// addon match; "fixing" it silently unmatches every addon whose files use bare `\r`.
fn rip_match<F>(content: &str, first_match: F) -> Vec<String>
where
    F: Fn(&str) -> Option<String>,
{
    content
        .split('\n')
        .filter_map(|piece| first_match(piece.trim()))
        .collect()
}

/// `.toc` includes: `/^\s*((?:(?<!\.\.).)+\.(?:xml|lua))\s*$/gim`.
///
/// The `m` flag matters: in JS, `^`/`$` also match around a bare `\r`, so a `\r`-only file
/// still yields its first include even though `ripMatch` handed the whole file over as one
/// piece.
fn toc_includes(content: &str) -> Vec<String> {
    rip_match(content, |piece| {
        piece
            .split(['\r', '\u{2028}', '\u{2029}'])
            .map(str::trim)
            .find(|line| {
                if line.is_empty() || line.contains("..") {
                    return false;
                }
                let lower = line.to_ascii_lowercase();
                lower.ends_with(".xml") || lower.ends_with(".lua")
            })
            .map(str::to_string)
    })
}

/// `<Include file="…"/>` / `<Script file="…"/>` —
/// `/<(?:Include|Script)\s+file=["']((?:(?<!\.\.).)+)["']\s*\/>/gis`.
///
/// `s` (dotall) plus a greedy `+` is the trap: on a piece holding several tags, the capture
/// runs from the first quote to the **last** quote that is still followed by `/>`. That
/// swallows the intervening markup, and since the result then contains tabs and carriage
/// returns the caller's invalid-character check aborts the whole include list. That is
/// exactly what the Electron build does, and therefore what CurseForge expects.
fn xml_includes(content: &str) -> Vec<String> {
    rip_match(content, |piece| {
        let lower = piece.to_ascii_lowercase();

        // Leftmost `<Include`/`<Script` that is followed by a `file="` attribute.
        let mut search = 0usize;
        loop {
            let tag = [
                lower[search..].find("<include"),
                lower[search..].find("<script"),
            ]
            .into_iter()
            .flatten()
            .min()?
                + search;

            let after = &piece[tag..];
            let Some(file_rel) = after.to_ascii_lowercase().find("file=") else {
                search = tag + 1;
                continue;
            };
            let rest = &after[file_rel + "file=".len()..];
            let Some(open) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
                search = tag + 1;
                continue;
            };
            let body = &rest[open.len_utf8()..];

            // Greedy: the LAST quote in this piece that is followed by optional whitespace
            // then `/>`.
            let end = body.char_indices().rev().find(|(i, c)| {
                (*c == '"' || *c == '\'') && body[i + c.len_utf8()..].trim_start().starts_with("/>")
            });

            let Some((end, _)) = end else {
                search = tag + 1;
                continue;
            };
            if end == 0 {
                // `+` requires at least one character.
                search = tag + 1;
                continue;
            }

            let value = &body[..end];
            // `(?<!\.\.)` — no character may be preceded by "..".
            if value.contains("..") {
                search = tag + 1;
                continue;
            }
            return Some(value.to_string());
        }
    })
}

/// The WowUp scanner's `matchAll`: run the global regex over the **whole** content and keep
/// every match, rather than one per `\n`-piece.
///
/// It also drops the `s` flag on the XML pattern, so `.` cannot cross a line terminator —
/// and in JS that includes bare `\r`. Together those mean WowUp follows every include in a
/// `\r`-delimited file where CurseForge follows none. The two fingerprints are consumed by
/// different services, so both behaviours are correct and they must not be unified.
fn toc_includes_all(content: &str) -> Vec<String> {
    content
        .split(['\n', '\r', '\u{2028}', '\u{2029}'])
        .map(str::trim)
        .filter(|line| {
            if line.is_empty() || line.contains("..") {
                return false;
            }
            let lower = line.to_ascii_lowercase();
            lower.ends_with(".xml") || lower.ends_with(".lua")
        })
        .map(str::to_string)
        .collect()
}

fn xml_includes_all(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    // `.` excludes line terminators without the `s` flag, so a tag cannot span one.
    for segment in content.split(['\n', '\r', '\u{2028}', '\u{2029}']) {
        let lower = segment.to_ascii_lowercase();
        let mut search = 0usize;

        while let Some(tag_rel) = [
            lower[search..].find("<include"),
            lower[search..].find("<script"),
        ]
        .into_iter()
        .flatten()
        .min()
        {
            let tag = search + tag_rel;
            let after = &segment[tag..];
            let Some(file_rel) = after.to_ascii_lowercase().find("file=") else {
                search = tag + 1;
                continue;
            };
            let rest = &after[file_rel + "file=".len()..];
            let Some(open) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
                search = tag + 1;
                continue;
            };
            let body = &rest[open.len_utf8()..];

            // Greedy within the segment: last quote followed by `/>`.
            match body.char_indices().rev().find(|(i, c)| {
                (*c == '"' || *c == '\'') && body[i + c.len_utf8()..].trim_start().starts_with("/>")
            }) {
                Some((end, _)) if end > 0 => {
                    let value = &body[..end];
                    if !value.contains("..") {
                        out.push(value.to_string());
                    }
                    // Continue after this tag, as the global flag does.
                    search = tag + file_rel + "file=".len() + open.len_utf8() + end;
                }
                _ => search = tag + 1,
            }
        }
    }
    out
}

/// Reads `name="value"` or `name='value'` out of a tag, case-insensitively.
fn attribute_value(segment: &str, name: &str) -> Option<String> {
    let lower = segment.to_ascii_lowercase();
    let at = lower.find(name)?;
    let after = &segment[at + name.len()..];
    let eq = after.find('=')?;
    let rest = after[eq + 1..].trim_start();
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let body = &rest[quote.len_utf8()..];
    let end = body.find(quote)?;
    Some(body[..end].to_string())
}

/// Collects the files that make up an addon's identity, in the order the JS produces.
/// Which include matcher to use. The two scanners genuinely differ here; see
/// `toc_includes_all`.
#[derive(Clone, Copy, PartialEq)]
enum Flavour {
    Curse,
    WowUp,
}

struct FolderScan {
    /// lowercased path -> real path, so includes resolve regardless of the case an author
    /// wrote. This is the whole reason Linux behaves like Windows here.
    file_map: HashMap<String, PathBuf>,
    matching: Vec<PathBuf>,
    seen: HashSet<PathBuf>,
    flavour: Flavour,
}

impl FolderScan {
    fn run(folder_path: &Path, flavour: Flavour) -> std::io::Result<Vec<PathBuf>> {
        let files = read_dir_recursive(folder_path)?;

        let mut scan = FolderScan {
            file_map: files
                .iter()
                .map(|p| (p.to_string_lossy().to_ascii_lowercase(), p.clone()))
                .collect(),
            matching: Vec::new(),
            seen: HashSet::new(),
            flavour,
        };

        // The JS strips `dirname(folderPath) + sep` from each path before matching, so the
        // patterns see `AddonName/File.toc`.
        let parent = folder_path
            .parent()
            .map(|p| format!("{}/", p.to_string_lossy()))
            .unwrap_or_default()
            .to_ascii_lowercase();

        let mut toc_files = Vec::new();
        for path in &files {
            let lower = path.to_string_lossy().to_ascii_lowercase();
            let relative = lower.strip_prefix(&parent).unwrap_or(&lower);

            if is_addon_toc(relative) {
                toc_files.push(path.clone());
            } else if is_bindings_xml(relative) {
                scan.push(path.clone());
            }
        }

        for toc in toc_files {
            scan.process_include(&toc);
        }

        let mut matching = scan.matching;
        // `_.orderBy(matchingFiles, f => f.toLowerCase())`.
        matching.sort_by_key(|p| p.to_string_lossy().to_ascii_lowercase());
        Ok(matching)
    }

    fn push(&mut self, path: PathBuf) {
        if self.seen.insert(path.clone()) {
            self.matching.push(path);
        }
    }

    /// Iterative rather than recursive: include graphs are author-controlled and a cycle
    /// would blow the stack. `seen` makes revisits free, which is also what stops a cycle.
    fn process_include(&mut self, start: &Path) {
        let mut queue = vec![start.to_path_buf()];

        while let Some(candidate) = queue.pop() {
            // Case-insensitive resolution through the folder's real file list.
            let key = candidate.to_string_lossy().to_ascii_lowercase();
            let Some(real) = self.file_map.get(&key).cloned() else {
                continue;
            };
            if !real.is_file() || self.seen.contains(&real) {
                continue;
            }
            self.push(real.clone());

            let Ok(raw) = std::fs::read(&real) else {
                continue;
            };
            // Includes are ASCII paths; lossy keeps a stray byte from dropping the file.
            let content = remove_comments(&real, &String::from_utf8_lossy(&raw));

            let ext = real
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase);
            let includes = match (ext.as_deref(), self.flavour) {
                (Some("toc"), Flavour::Curse) => toc_includes(&content),
                (Some("xml"), Flavour::Curse) => xml_includes(&content),
                (Some("toc"), Flavour::WowUp) => toc_includes_all(&content),
                (Some("xml"), Flavour::WowUp) => xml_includes_all(&content),
                _ => continue,
            };

            let Some(dir) = real.parent() else { continue };
            for include in includes {
                if has_invalid_path_chars(&include) {
                    log::debug!("Invalid include file {}", real.display());
                    break; // `break`, not `continue` — matching the JS.
                }
                queue.push(dir.join(include.replace('\\', "/")));
            }
        }
    }
}

fn folder_name(folder_path: &Path) -> String {
    folder_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Port of `CurseFolderScanner.scanFolder`.
fn scan_curse(folder_path: &Path) -> std::io::Result<AddonScanResult> {
    let matching = FolderScan::run(folder_path, Flavour::Curse)?;

    let mut hashes: Vec<u32> = Vec::with_capacity(matching.len());
    for file in &matching {
        match std::fs::read(file) {
            Ok(bytes) => hashes.push(compute_hash(&bytes)),
            // The JS pushes -1 and then filters it out, so an unreadable file is skipped
            // rather than poisoning the fingerprint.
            Err(e) => log::error!("Failed to get filehash: {} {e}", file.display()),
        }
    }

    // `_.orderBy` on numbers is a numeric sort.
    hashes.sort_unstable();
    let concat: String = hashes.iter().map(|h| h.to_string()).collect();
    let fingerprint = compute_hash(concat.as_bytes());

    Ok(AddonScanResult {
        source: "curseforge".to_string(),
        file_count: matching.len(),
        file_fingerprints: None,
        fingerprint: fingerprint.to_string(),
        fingerprint_num: fingerprint,
        folder_name: folder_name(folder_path),
        path: folder_path.to_string_lossy().into_owned(),
    })
}

/// Port of `WowUpFolderScanner.scanFolder` — md5 rather than the CurseForge fingerprint.
fn scan_wowup(folder_path: &Path) -> std::io::Result<AddonScanResult> {
    let matching = FolderScan::run(folder_path, Flavour::WowUp)?;

    let mut hashes: Vec<String> = Vec::with_capacity(matching.len());
    for file in &matching {
        // The JS lets a read failure reject the whole scan here; skipping is kinder and the
        // file is already missing from `matching` in every case we can produce.
        match std::fs::read(file) {
            Ok(bytes) => hashes.push(format!("{:x}", md5::compute(&bytes))),
            Err(e) => log::error!("hashFile failed: {} {e}", file.display()),
        }
    }

    let file_fingerprints = hashes.clone();
    // `_.orderBy` on strings is lexicographic.
    hashes.sort();
    let concat = hashes.concat();
    let fingerprint = format!("{:x}", md5::compute(concat.as_bytes()));

    Ok(AddonScanResult {
        source: "wowup".to_string(),
        file_count: matching.len(),
        file_fingerprints: Some(file_fingerprints),
        fingerprint,
        // The JS hardcodes 0 here.
        fingerprint_num: 0,
        folder_name: folder_name(folder_path),
        path: folder_path.to_string_lossy().into_owned(),
    })
}

/// Runs the scans off the async runtime: they are CPU- and IO-bound over hundreds of
/// folders, and blocking Tauri's main async thread freezes the UI mid-scan.
async fn scan_all(
    file_paths: Vec<String>,
    scan: fn(&Path) -> std::io::Result<AddonScanResult>,
    label: &'static str,
) -> Result<Vec<AddonScanResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::with_capacity(file_paths.len());
        for folder in file_paths {
            let path = PathBuf::from(&folder);
            match scan(&path) {
                Ok(result) => results.push(result),
                // One unreadable addon folder should not fail the whole scan and leave the
                // user with no addons at all.
                Err(e) => log::error!("[{label}] failed to scan {folder}: {e}"),
            }
        }
        results
    })
    .await
    .map_err(|e| format!("{label} scan panicked: {e}"))
}

#[tauri::command]
pub async fn curse_get_scan_results(
    file_paths: Vec<String>,
) -> Result<Vec<AddonScanResult>, String> {
    scan_all(file_paths, scan_curse, "curse").await
}

#[tauri::command]
pub async fn wowup_get_scan_results(
    file_paths: Vec<String>,
) -> Result<Vec<AddonScanResult>, String> {
    scan_all(file_paths, scan_wowup, "wowup").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_toc_named_after_its_folder_matches() {
        assert!(is_addon_toc("weakauras/weakauras.toc"));
        assert!(is_addon_toc("dbm-core/dbm-core.toc"));
    }

    #[test]
    fn flavour_suffixes_match() {
        for f in [
            "mainline", "bcc", "tbc", "classic", "vanilla", "wrath", "wotlkc", "cata", "mists",
        ] {
            assert!(is_addon_toc(&format!("weakauras/weakauras-{f}.toc")), "{f}");
            assert!(is_addon_toc(&format!("weakauras/weakauras_{f}.toc")), "{f}");
        }
    }

    #[test]
    fn other_tocs_in_the_folder_do_not_match() {
        // Libraries ship their own .toc files; counting them would change the fingerprint.
        assert!(!is_addon_toc("weakauras/libs.toc"));
        assert!(!is_addon_toc("weakauras/weakauras-nonsense.toc"));
        assert!(!is_addon_toc("weakauras/sub/weakauras.toc"));
        assert!(!is_addon_toc("weakauras.toc"));
    }

    #[test]
    fn bindings_xml_matches_only_at_the_top_level() {
        assert!(is_bindings_xml("weakauras/bindings.xml"));
        assert!(!is_bindings_xml("weakauras/sub/bindings.xml"));
        assert!(!is_bindings_xml("bindings.xml"));
    }

    #[test]
    fn toc_comments_are_stripped() {
        assert_eq!(
            remove_comments(Path::new("a.toc"), "## Title: X\nfile.lua # trailing\n"),
            "\nfile.lua"
        );
    }

    #[test]
    fn xml_comments_are_stripped_across_lines() {
        assert_eq!(
            strip_xml_comments("<a/><!-- one\ntwo -->\n<b/>"),
            "<a/>\n<b/>"
        );
        // Unterminated: the regex would swallow the rest, so this does too.
        assert_eq!(strip_xml_comments("<a/><!-- oops"), "<a/>");
    }

    #[test]
    fn toc_includes_are_lua_and_xml_paths_only() {
        let includes =
            toc_includes("## Title: X\nCore.lua\nUI.xml\nnotes.txt\n\n  Sub\\Thing.lua  ");
        assert_eq!(includes, vec!["Core.lua", "UI.xml", "Sub\\Thing.lua"]);
    }

    #[test]
    fn toc_includes_reject_parent_traversal() {
        // `(?<!\.\.)` in the original — an addon must not reach outside its folder.
        assert!(toc_includes("../../evil.lua").is_empty());
    }

    #[test]
    fn xml_includes_read_both_tags_and_both_quote_styles() {
        let content = r#"
            <Include file="Core.lua"/>
            <Script file='UI.xml' />
            <Include file="../evil.lua"/>
            <Other file="ignored.lua"/>
        "#;
        assert_eq!(xml_includes(content), vec!["Core.lua", "UI.xml"]);
    }

    /// The bare-`\r` case, which is what 10 of 307 real addon folders hinge on.
    ///
    /// `libs/load_libs.xml` in GreatVault separates its tags with `\r` alone. CurseForge
    /// sees one piece, its greedy dotall capture swallows the whole line, the result holds
    /// tabs and carriage returns, and the caller's invalid-character check aborts — so it
    /// follows nothing. WowUp's pattern has no `s` flag, so `.` stops at the `\r` and every
    /// tag matches. Unifying the two changes both fingerprints.
    #[test]
    fn carriage_return_only_xml_is_read_differently_by_each_scanner() {
        let xml = "<Ui>\r\t<script file=\"A.lua\"/>\r\t<Include file=\"B.xml\"/>\r</Ui>";

        let curse = xml_includes(xml);
        assert_eq!(curse.len(), 1, "curse takes one greedy match: {curse:?}");
        assert!(curse[0].contains('\r'), "and it spans the tags: {curse:?}");

        assert_eq!(xml_includes_all(xml), vec!["A.lua", "B.xml"]);
    }

    /// With `\r\n`, both agree — which is why only some folders differed.
    #[test]
    fn crlf_xml_is_read_the_same_by_both() {
        let xml = "<Ui>\r\n\t<script file=\"A.lua\"/>\r\n\t<Include file=\"B.xml\"/>\r\n</Ui>";
        assert_eq!(xml_includes(xml), vec!["A.lua", "B.xml"]);
        assert_eq!(xml_includes_all(xml), vec!["A.lua", "B.xml"]);
    }

    #[test]
    fn invalid_path_chars_are_rejected() {
        assert!(has_invalid_path_chars("a|b"));
        assert!(has_invalid_path_chars("a\u{1}b"));
        assert!(has_invalid_path_chars("a\tb"));
        assert!(!has_invalid_path_chars("Sub/Thing.lua"));
    }

    /// The end-to-end shape, on a folder built to look like a real addon.
    #[test]
    fn scans_a_folder_and_follows_includes() {
        let root = std::env::temp_dir().join("wowup-scan-test");
        let addon = root.join("WeakAuras");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(addon.join("Sub")).unwrap();

        std::fs::write(
            addon.join("WeakAuras.toc"),
            "## Title: WA\nCore.lua\nUI.xml\n",
        )
        .unwrap();
        std::fs::write(addon.join("Core.lua"), "-- core").unwrap();
        std::fs::write(addon.join("UI.xml"), "<Include file=\"Sub/Extra.lua\"/>").unwrap();
        std::fs::write(addon.join("Sub/Extra.lua"), "-- extra").unwrap();
        // Not referenced by anything, so it must not be counted.
        std::fs::write(addon.join("Unused.lua"), "-- unused").unwrap();

        let result = scan_curse(&addon).unwrap();

        assert_eq!(result.folder_name, "WeakAuras");
        assert_eq!(result.source, "curseforge");
        // toc + Core.lua + UI.xml + Sub/Extra.lua — and not Unused.lua.
        assert_eq!(result.file_count, 4);
        assert_eq!(result.fingerprint, result.fingerprint_num.to_string());
    }

    #[test]
    fn the_two_scanners_agree_on_which_files_count() {
        let root = std::env::temp_dir().join("wowup-scan-agree");
        let addon = root.join("DBM-Core");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&addon).unwrap();
        std::fs::write(addon.join("DBM-Core.toc"), "Core.lua\n").unwrap();
        std::fs::write(addon.join("Core.lua"), "-- x").unwrap();

        let curse = scan_curse(&addon).unwrap();
        let wowup = scan_wowup(&addon).unwrap();

        assert_eq!(curse.file_count, wowup.file_count);
        assert_eq!(wowup.source, "wowup");
        assert_eq!(wowup.fingerprint_num, 0);
        assert_eq!(wowup.file_fingerprints.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn a_cyclic_include_graph_terminates() {
        let root = std::env::temp_dir().join("wowup-scan-cycle");
        let addon = root.join("Loopy");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&addon).unwrap();
        std::fs::write(addon.join("Loopy.toc"), "A.xml\n").unwrap();
        std::fs::write(addon.join("A.xml"), "<Include file=\"B.xml\"/>").unwrap();
        std::fs::write(addon.join("B.xml"), "<Include file=\"A.xml\"/>").unwrap();

        let result = scan_curse(&addon).unwrap();
        assert_eq!(result.file_count, 3);
    }

    #[test]
    fn includes_resolve_regardless_of_case() {
        // Authors write `core.lua` for a file named `Core.lua`; on Linux only the file map
        // saves this, and a miss silently drops the file from the fingerprint.
        let root = std::env::temp_dir().join("wowup-scan-case");
        let addon = root.join("CaseTest");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&addon).unwrap();
        std::fs::write(addon.join("CaseTest.toc"), "CORE.LUA\n").unwrap();
        std::fs::write(addon.join("Core.lua"), "-- x").unwrap();

        assert_eq!(scan_curse(&addon).unwrap().file_count, 2);
    }
}

/// Diff harness: prints the fingerprints for the given folders so they can be compared
/// against the Electron scanners. Not part of the app — `cargo test -- --ignored diff_real`.
#[cfg(test)]
mod real_folder_diff {
    use super::*;

    #[test]
    #[ignore]
    fn diff_real() {
        for folder in std::env::var("WOWUP_SCAN_DIRS")
            .unwrap_or_default()
            .split(':')
        {
            if folder.is_empty() {
                continue;
            }
            let p = Path::new(folder);
            if std::env::var("WOWUP_SCAN_FILES").is_ok() {
                for f in FolderScan::run(p, Flavour::Curse).unwrap() {
                    println!("FILE {}", f.display());
                }
                continue;
            }
            let c = scan_curse(p).unwrap();
            let w = scan_wowup(p).unwrap();
            println!(
                "{{\"folder\":\"{}\",\"curse\":{{\"fp\":\"{}\",\"n\":{}}},\"wowup\":{{\"fp\":\"{}\",\"n\":{}}}}}",
                c.folder_name, c.fingerprint, c.file_count, w.fingerprint, w.file_count
            );
        }
    }
}
