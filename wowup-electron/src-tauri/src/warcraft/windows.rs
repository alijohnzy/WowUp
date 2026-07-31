//! Port of `app/services/warcraft/warcraft-platform.win.ts`.
//!
//! Two differences from the other platforms: WoW ships separate `-arm64.exe` binaries, and
//! the Battle.net agent has to be found by sweeping mounted drives.

use super::{
    base_name, path_exists, InstalledProduct, WowClientType, BLIZZARD_PRODUCT_DB_NAME,
    WOW_ANNIVERSARY_FOLDER, WOW_CLASSIC_ERA_FOLDER, WOW_CLASSIC_ERA_PTR_FOLDER,
    WOW_RETAIL_XPTR_FOLDER,
};
use std::path::Path;

const WOW_RETAIL_NAME: &str = "Wow.exe";
const WOW_RETAIL_PTR_NAME: &str = "WowT.exe";
const WOW_RETAIL_BETA_NAME: &str = "WowB.exe";
const WOW_CLASSIC_NAME: &str = "WowClassic.exe";
const WOW_CLASSIC_PTR_NAME: &str = "WowClassicT.exe";
const WOW_CLASSIC_BETA_NAME: &str = "WowClassicB.exe";

const WOW_RETAIL_NAME_ARM64: &str = "Wow-arm64.exe";
const WOW_RETAIL_PTR_NAME_ARM64: &str = "WowT-arm64.exe";
const WOW_RETAIL_BETA_NAME_ARM64: &str = "WowB-arm64.exe";
const WOW_CLASSIC_NAME_ARM64: &str = "WowClassic-arm64.exe";
const WOW_CLASSIC_PTR_NAME_ARM64: &str = "WowClassicT-arm64.exe";
const WOW_CLASSIC_BETA_NAME_ARM64: &str = "WowClassicB-arm64.exe";

const WOW_APP_NAMES: [&str; 6] = [
    WOW_RETAIL_NAME,
    WOW_RETAIL_PTR_NAME,
    WOW_RETAIL_BETA_NAME,
    WOW_CLASSIC_NAME,
    WOW_CLASSIC_PTR_NAME,
    WOW_CLASSIC_BETA_NAME,
];

const WOW_APP_NAMES_ARM64: [&str; 6] = [
    WOW_RETAIL_NAME_ARM64,
    WOW_RETAIL_PTR_NAME_ARM64,
    WOW_RETAIL_BETA_NAME_ARM64,
    WOW_CLASSIC_NAME_ARM64,
    WOW_CLASSIC_PTR_NAME_ARM64,
    WOW_CLASSIC_BETA_NAME_ARM64,
];

const WINDOWS_BLIZZARD_AGENT_PATH: &str = "ProgramData/Battle.net/Agent";

/// `process.arch === "arm64"` in the JS. Resolved at compile time here, which is the same
/// thing in practice: an arm64 build runs on arm64.
const fn is_arm64() -> bool {
    cfg!(target_arch = "aarch64")
}

pub fn get_executable_extension() -> &'static str {
    "exe"
}

pub fn is_wow_application(app_name: &str) -> bool {
    let names = if is_arm64() {
        &WOW_APP_NAMES_ARM64
    } else {
        &WOW_APP_NAMES
    };
    names.contains(&app_name)
}

pub fn get_executable_name(client_type: WowClientType) -> String {
    let arm = is_arm64();
    match client_type {
        WowClientType::Retail => {
            if arm { WOW_RETAIL_NAME_ARM64 } else { WOW_RETAIL_NAME }
        }
        WowClientType::ClassicEra | WowClientType::Classic | WowClientType::Anniversary => {
            if arm { WOW_CLASSIC_NAME_ARM64 } else { WOW_CLASSIC_NAME }
        }
        WowClientType::RetailPtr | WowClientType::RetailXPtr => {
            if arm { WOW_RETAIL_PTR_NAME_ARM64 } else { WOW_RETAIL_PTR_NAME }
        }
        WowClientType::ClassicPtr | WowClientType::ClassicEraPtr => {
            if arm { WOW_CLASSIC_PTR_NAME_ARM64 } else { WOW_CLASSIC_PTR_NAME }
        }
        WowClientType::Beta => {
            if arm { WOW_RETAIL_BETA_NAME_ARM64 } else { WOW_RETAIL_BETA_NAME }
        }
        WowClientType::ClassicBeta => {
            if arm { WOW_CLASSIC_BETA_NAME_ARM64 } else { WOW_CLASSIC_BETA_NAME }
        }
        WowClientType::None => "",
    }
    .to_string()
}

/// Both the x64 and arm64 names map to the same client type — the JS matched on either in
/// a single `case` list, so an arm64 install is still recognised by an x64 build.
pub fn get_client_type(binary_path: &str) -> WowClientType {
    let lower = binary_path.to_lowercase();
    let client_type = match base_name(binary_path) {
        WOW_RETAIL_NAME | WOW_RETAIL_NAME_ARM64 => WowClientType::Retail,
        WOW_CLASSIC_NAME | WOW_CLASSIC_NAME_ARM64 => {
            if lower.contains(WOW_CLASSIC_ERA_FOLDER) {
                WowClientType::ClassicEra
            } else if lower.contains(WOW_ANNIVERSARY_FOLDER) {
                WowClientType::Anniversary
            } else {
                WowClientType::Classic
            }
        }
        WOW_RETAIL_PTR_NAME | WOW_RETAIL_PTR_NAME_ARM64 => {
            if lower.contains(WOW_RETAIL_XPTR_FOLDER) {
                WowClientType::RetailXPtr
            } else {
                WowClientType::RetailPtr
            }
        }
        WOW_CLASSIC_PTR_NAME | WOW_CLASSIC_PTR_NAME_ARM64 => {
            if lower.contains(WOW_CLASSIC_ERA_PTR_FOLDER) {
                WowClientType::ClassicEraPtr
            } else {
                WowClientType::ClassicPtr
            }
        }
        WOW_RETAIL_BETA_NAME | WOW_RETAIL_BETA_NAME_ARM64 => WowClientType::Beta,
        WOW_CLASSIC_BETA_NAME | WOW_CLASSIC_BETA_NAME_ARM64 => WowClientType::ClassicBeta,
        _ => WowClientType::None,
    };

    if client_type == WowClientType::None {
        log::warn!("Unknown client type for binary path: {binary_path}");
    }

    client_type
}

/// The JS enumerated mounted volumes with `node-disk-info` purely to build candidate paths
/// and stat each one. Probing drive letters does the same job without the dependency (and
/// without spawning `wmic`, which `node-disk-info` shells out to and which Microsoft has
/// deprecated).
pub async fn get_blizzard_agent_path() -> String {
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        let agent_path = Path::new(&root)
            .join(WINDOWS_BLIZZARD_AGENT_PATH)
            .join(BLIZZARD_PRODUCT_DB_NAME);

        if path_exists(&agent_path).await {
            log::info!("Found products at {}", agent_path.display());
            return agent_path.to_string_lossy().into_owned();
        }
    }

    String::new()
}

/// Windows paths in product.db are already absolute and correct.
pub fn resolve_products(decoded: Vec<InstalledProduct>, _agent_path: &str) -> Vec<InstalledProduct> {
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_type_recognises_both_x64_and_arm64_binaries() {
        assert_eq!(
            get_client_type("C:\\WoW\\_retail_\\Wow.exe"),
            WowClientType::Retail
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_retail_\\Wow-arm64.exe"),
            WowClientType::Retail
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_classic_era_\\WowClassic-arm64.exe"),
            WowClientType::ClassicEra
        );
        assert_eq!(
            get_client_type("C:\\WoW\\_xptr_\\WowT-arm64.exe"),
            WowClientType::RetailXPtr
        );
    }

    #[test]
    fn unknown_binary_is_none() {
        assert_eq!(get_client_type("C:\\Windows\\explorer.exe"), WowClientType::None);
    }

    #[test]
    fn executable_name_matches_the_build_architecture() {
        let expected = if is_arm64() { "Wow-arm64.exe" } else { "Wow.exe" };
        assert_eq!(get_executable_name(WowClientType::Retail), expected);
        assert_eq!(get_executable_name(WowClientType::None), "");
    }

    #[test]
    fn resolve_products_is_a_passthrough() {
        let decoded = vec![InstalledProduct {
            name: "_retail_".into(),
            location: "C:\\WoW\\_retail_".into(),
            client_type: WowClientType::Retail,
        }];
        assert_eq!(resolve_products(decoded.clone(), "C:\\whatever"), decoded);
    }
}
