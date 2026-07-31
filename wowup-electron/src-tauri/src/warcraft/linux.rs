//! Port of `app/services/warcraft/warcraft-platform.linux.ts`.
//!
//! WoW on Linux runs under Wine, so everything is a Windows layout inside a Lutris prefix:
//! the executables are still `.exe` and product.db still holds `C:\...` paths.

use super::{
    base_name, path_exists, InstalledProduct, WowClientType, BLIZZARD_PRODUCT_DB_NAME,
    WOW_ANNIVERSARY_FOLDER, WOW_CLASSIC_ERA_FOLDER, WOW_CLASSIC_ERA_PTR_FOLDER,
    WOW_RETAIL_XPTR_FOLDER,
};
use std::path::{Path, PathBuf};

const WOW_RETAIL_NAME: &str = "Wow.exe";
const WOW_RETAIL_PTR_NAME: &str = "WowT.exe";
const WOW_RETAIL_BETA_NAME: &str = "WowB.exe";
const WOW_CLASSIC_NAME: &str = "WowClassic.exe";
const WOW_CLASSIC_PTR_NAME: &str = "WowClassicT.exe";
const WOW_CLASSIC_BETA_NAME: &str = "WowClassicB.exe";

const WOW_APP_NAMES: [&str; 6] = [
    WOW_RETAIL_NAME,
    WOW_RETAIL_PTR_NAME,
    WOW_RETAIL_BETA_NAME,
    WOW_CLASSIC_NAME,
    WOW_CLASSIC_PTR_NAME,
    WOW_CLASSIC_BETA_NAME,
];

const LUTRIS_CONFIG_PATH: &str = ".config/lutris/system.yml";
const LUTRIS_WOW_DIRS: [&str; 3] = [
    "battlenet/drive_c",
    "world-of-warcraft/drive_c",
    "world-of-warcraft-classic/drive_c",
];
const WINDOWS_BLIZZARD_AGENT_PATH: &str = "ProgramData/Battle.net/Agent";

pub fn get_executable_extension() -> &'static str {
    "exe"
}

pub fn is_wow_application(app_name: &str) -> bool {
    WOW_APP_NAMES.contains(&app_name)
}

pub fn get_executable_name(client_type: WowClientType) -> String {
    match client_type {
        WowClientType::Retail => WOW_RETAIL_NAME,
        WowClientType::ClassicEra | WowClientType::Classic | WowClientType::Anniversary => {
            WOW_CLASSIC_NAME
        }
        WowClientType::RetailPtr | WowClientType::RetailXPtr => WOW_RETAIL_PTR_NAME,
        WowClientType::ClassicPtr | WowClientType::ClassicEraPtr => WOW_CLASSIC_PTR_NAME,
        WowClientType::Beta => WOW_RETAIL_BETA_NAME,
        WowClientType::ClassicBeta => WOW_CLASSIC_BETA_NAME,
        WowClientType::None => "",
    }
    .to_string()
}

pub fn get_client_type(binary_path: &str) -> WowClientType {
    let lower = binary_path.to_lowercase();
    match base_name(binary_path) {
        WOW_RETAIL_NAME => WowClientType::Retail,
        WOW_CLASSIC_NAME => {
            if lower.contains(WOW_CLASSIC_ERA_FOLDER) {
                WowClientType::ClassicEra
            } else if lower.contains(WOW_ANNIVERSARY_FOLDER) {
                WowClientType::Anniversary
            } else {
                WowClientType::Classic
            }
        }
        WOW_RETAIL_PTR_NAME => {
            if lower.contains(WOW_RETAIL_XPTR_FOLDER) {
                WowClientType::RetailXPtr
            } else {
                WowClientType::RetailPtr
            }
        }
        WOW_CLASSIC_PTR_NAME => {
            if lower.contains(WOW_CLASSIC_ERA_PTR_FOLDER) {
                WowClientType::ClassicEraPtr
            } else {
                WowClientType::ClassicPtr
            }
        }
        WOW_RETAIL_BETA_NAME => WowClientType::Beta,
        WOW_CLASSIC_BETA_NAME => WowClientType::ClassicBeta,
        _ => WowClientType::None,
    }
}

pub async fn get_blizzard_agent_path() -> String {
    let library_path = match lutris_wow_path().await {
        Some(p) => p,
        None => {
            log::error!("Lutris library not found");
            return String::new();
        }
    };

    let agent_path = library_path
        .join(WINDOWS_BLIZZARD_AGENT_PATH)
        .join(BLIZZARD_PRODUCT_DB_NAME);

    if path_exists(&agent_path).await {
        log::info!("Found WoW products at {}", agent_path.display());
        return agent_path.to_string_lossy().into_owned();
    }

    String::new()
}

/// Port of `resolveProducts` (warcraft-platform.linux.ts:118).
///
/// product.db stores `C:\Program Files\...`. The real location is that path rebased onto
/// the Wine prefix, so the leading `C:\` (3 chars) is dropped and the prefix's `drive_c`
/// substituted. Products whose agent path has no `drive_c` are skipped, as in the JS.
pub fn resolve_products(decoded: Vec<InstalledProduct>, agent_path: &str) -> Vec<InstalledProduct> {
    let Some(prefix) = drive_c_prefix(agent_path) else {
        log::warn!("No agentPath match found");
        return Vec::new();
    };

    decoded
        .into_iter()
        .map(|p| {
            // `substring(3)` in the JS: strip the `C:\` drive qualifier.
            let rest: String = p.location.chars().skip(3).collect();
            InstalledProduct {
                location: join_windows_relative(prefix, &rest),
                ..p
            }
        })
        .collect()
}

/// Equivalent of `/.*drive_c/` — the longest prefix of `agent_path` ending at `drive_c`.
fn drive_c_prefix(agent_path: &str) -> Option<&str> {
    agent_path
        .rfind("drive_c")
        .map(|i| agent_path[..i + "drive_c".len()].trim())
}

/// `path.join` on Linux treats a Windows-relative `Foo\Bar` as one segment. The JS relied
/// on that: the stored separators survive into the final path and Wine resolves them. Keep
/// the same behaviour rather than "fixing" it, so paths still match what the addon
/// scanner and the Electron build produce.
fn join_windows_relative(prefix: &str, rest: &str) -> String {
    Path::new(prefix)
        .join(rest)
        .to_string_lossy()
        .into_owned()
}

async fn lutris_wow_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let config = Path::new(&home).join(LUTRIS_CONFIG_PATH);

    let contents = match tokio::fs::read_to_string(&config).await {
        Ok(c) => c,
        Err(_) => {
            log::error!("Lutris config not found at {}", config.display());
            return None;
        }
    };

    let library_path = contents
        .lines()
        .find_map(|l| l.trim().strip_prefix("game_path:"))
        .map(str::trim)?;

    if !path_exists(library_path).await {
        log::error!("Lutris library path does not exist: {library_path}");
        return None;
    }

    for dir in LUTRIS_WOW_DIRS {
        let product_path = Path::new(library_path).join(dir);
        if path_exists(&product_path).await {
            log::info!("Found WoW product in Lutris library at {}", product_path.display());
            return Some(product_path);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_wow_binaries() {
        assert!(is_wow_application("Wow.exe"));
        assert!(is_wow_application("WowClassic.exe"));
        assert!(!is_wow_application("Wow-arm64.exe")); // Windows-only name
        assert!(!is_wow_application("notepad.exe"));
    }

    #[test]
    fn client_type_from_windows_style_paths() {
        assert_eq!(
            get_client_type("C:\\Program Files\\World of Warcraft\\_retail_\\Wow.exe"),
            WowClientType::Retail
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_era_\\WowClassic.exe"),
            WowClientType::ClassicEra
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_anniversary_\\WowClassic.exe"),
            WowClientType::Anniversary
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_\\WowClassic.exe"),
            WowClientType::Classic
        );
        assert_eq!(get_client_type("C:\\WoW\\_xptr_\\WowT.exe"), WowClientType::RetailXPtr);
        assert_eq!(get_client_type("C:\\WoW\\_ptr_\\WowT.exe"), WowClientType::RetailPtr);
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_era_ptr_\\WowClassicT.exe"),
            WowClientType::ClassicEraPtr
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_ptr_\\WowClassicT.exe"),
            WowClientType::ClassicPtr
        );
        assert_eq!(get_client_type("C:\\WoW\\_beta_\\WowB.exe"), WowClientType::Beta);
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_beta_\\WowClassicB.exe"),
            WowClientType::ClassicBeta
        );
        assert_eq!(get_client_type("C:\\WoW\\explorer.exe"), WowClientType::None);
    }

    /// The folder check is case-insensitive in the JS (`.toLowerCase()`), and Wine prefixes
    /// are routinely mixed-case.
    #[test]
    fn folder_discrimination_is_case_insensitive() {
        assert_eq!(
            get_client_type("C:\\WoW\\_Classic_Era_\\WowClassic.exe"),
            WowClientType::ClassicEra
        );
    }

    #[test]
    fn resolve_products_rebases_onto_the_wine_prefix() {
        let agent = "/home/u/Games/battlenet/drive_c/ProgramData/Battle.net/Agent/product.db";
        let decoded = vec![InstalledProduct {
            name: "_retail_".into(),
            location: "C:\\Program Files\\World of Warcraft\\_retail_".into(),
            client_type: WowClientType::Retail,
        }];

        let resolved = resolve_products(decoded, agent);
        assert_eq!(
            resolved[0].location,
            "/home/u/Games/battlenet/drive_c/Program Files\\World of Warcraft\\_retail_"
        );
    }

    #[test]
    fn resolve_products_drops_everything_when_agent_path_has_no_drive_c() {
        let decoded = vec![InstalledProduct {
            name: "_retail_".into(),
            location: "C:\\WoW".into(),
            client_type: WowClientType::Retail,
        }];
        assert!(resolve_products(decoded, "/opt/wow/product.db").is_empty());
    }

    #[test]
    fn drive_c_prefix_takes_the_last_occurrence() {
        // A library path that itself contains "drive_c" must not truncate early.
        assert_eq!(
            drive_c_prefix("/home/drive_c_backup/games/wow/drive_c/ProgramData"),
            Some("/home/drive_c_backup/games/wow/drive_c")
        );
    }

    #[test]
    fn executable_name_covers_every_client_type() {
        assert_eq!(get_executable_name(WowClientType::Retail), "Wow.exe");
        assert_eq!(get_executable_name(WowClientType::Classic), "WowClassic.exe");
        assert_eq!(get_executable_name(WowClientType::Anniversary), "WowClassic.exe");
        assert_eq!(get_executable_name(WowClientType::RetailXPtr), "WowT.exe");
        assert_eq!(get_executable_name(WowClientType::ClassicEraPtr), "WowClassicT.exe");
        assert_eq!(get_executable_name(WowClientType::Beta), "WowB.exe");
        assert_eq!(get_executable_name(WowClientType::ClassicBeta), "WowClassicB.exe");
        assert_eq!(get_executable_name(WowClientType::None), "");
    }
}
