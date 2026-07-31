//! Port of `app/services/warcraft/warcraft-platform.mac.ts`.
//!
//! macOS ships WoW as `.app` bundles, and Battle.net always installs its agent to a fixed
//! shared path, so there is no drive sweep and no prefix rebasing.

use super::{
    base_name, path_exists, InstalledProduct, WowClientType, BLIZZARD_PRODUCT_DB_NAME,
    WOW_ANNIVERSARY_FOLDER, WOW_CLASSIC_ERA_FOLDER, WOW_CLASSIC_ERA_PTR_FOLDER,
    WOW_RETAIL_XPTR_FOLDER,
};
use std::path::Path;

const WOW_RETAIL_NAME: &str = "World of Warcraft.app";
const WOW_RETAIL_PTR_NAME: &str = "World of Warcraft Test.app";
const WOW_RETAIL_BETA_NAME: &str = "World of Warcraft Beta.app";
const WOW_CLASSIC_NAME: &str = "World of Warcraft Classic.app";
const WOW_CLASSIC_PTR_NAME: &str = "World of Warcraft Classic Test.app";
const WOW_CLASSIC_BETA_NAME: &str = "World of Warcraft Classic Beta.app";

const WOW_APP_NAMES: [&str; 6] = [
    WOW_RETAIL_NAME,
    WOW_RETAIL_PTR_NAME,
    WOW_CLASSIC_NAME,
    WOW_CLASSIC_PTR_NAME,
    WOW_RETAIL_BETA_NAME,
    WOW_CLASSIC_BETA_NAME,
];

const BLIZZARD_AGENT_PATH: &str = "/Users/Shared/Battle.net/Agent";

pub fn get_executable_extension() -> &'static str {
    "app"
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
    let agent_path = Path::new(BLIZZARD_AGENT_PATH).join(BLIZZARD_PRODUCT_DB_NAME);
    if path_exists(&agent_path).await {
        agent_path.to_string_lossy().into_owned()
    } else {
        String::new()
    }
}

/// macOS paths in product.db are already absolute and correct.
pub fn resolve_products(
    decoded: Vec<InstalledProduct>,
    _agent_path: &str,
) -> Vec<InstalledProduct> {
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_app_bundles() {
        assert!(is_wow_application("World of Warcraft.app"));
        assert!(is_wow_application("World of Warcraft Classic Beta.app"));
        assert!(!is_wow_application("Safari.app"));
    }

    #[test]
    fn client_type_from_bundle_paths() {
        assert_eq!(
            get_client_type("/Applications/World of Warcraft/_retail_/World of Warcraft.app"),
            WowClientType::Retail
        );
        assert_eq!(
            get_client_type("/Applications/WoW/_classic_era_/World of Warcraft Classic.app"),
            WowClientType::ClassicEra
        );
        assert_eq!(
            get_client_type("/Applications/WoW/_anniversary_/World of Warcraft Classic.app"),
            WowClientType::Anniversary
        );
        assert_eq!(
            get_client_type("/Applications/WoW/_xptr_/World of Warcraft Test.app"),
            WowClientType::RetailXPtr
        );
        assert_eq!(
            get_client_type(
                "/Applications/WoW/_classic_era_ptr_/World of Warcraft Classic Test.app"
            ),
            WowClientType::ClassicEraPtr
        );
        assert_eq!(
            get_client_type("/Applications/Safari.app"),
            WowClientType::None
        );
    }

    #[test]
    fn executable_extension_is_app() {
        assert_eq!(get_executable_extension(), "app");
    }

    #[test]
    fn resolve_products_is_a_passthrough() {
        let decoded = vec![InstalledProduct {
            name: "_retail_".into(),
            location: "/Applications/World of Warcraft/_retail_".into(),
            client_type: WowClientType::Retail,
        }];
        assert_eq!(resolve_products(decoded.clone(), "/whatever"), decoded);
    }
}
