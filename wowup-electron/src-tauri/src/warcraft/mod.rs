//! Warcraft installation detection.
//!
//! Port of `app/services/warcraft/` + `app/controllers/warcraft/warcraft.controller.ts`,
//! the first vertical slice of the Tauri migration. The platform split that was three
//! classes behind a `WarcraftPlatform` interface is three `#[cfg(target_os)]` modules
//! behind the same set of free functions.

pub mod product_db;

#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::path::Path;

/// Mirrors `WowClientType` in wowup-lib-core (`wowup-lib/src/types.ts:70`).
///
/// The discriminants are load-bearing: this crosses IPC as a bare number and the Svelte
/// renderer compares it against the TypeScript enum. Reordering silently remaps every
/// client type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum WowClientType {
    Retail = 0,
    Classic = 1,
    RetailPtr = 2,
    ClassicPtr = 3,
    Beta = 4,
    ClassicBeta = 5,
    ClassicEra = 6,
    ClassicEraPtr = 7,
    RetailXPtr = 8,
    Anniversary = 9,
    None = 10,
}

/// Mirrors `InstalledProduct` (`wowup-lib/src/models/warcraft.ts:13`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledProduct {
    pub name: String,
    pub location: String,
    pub client_type: WowClientType,
}

// The `_folder_` names Blizzard writes into product.db, from src/common/constants.ts:210.
pub const WOW_BETA_FOLDER: &str = "_beta_";
pub const WOW_CLASSIC_FOLDER: &str = "_classic_";
pub const WOW_CLASSIC_BETA_FOLDER: &str = "_classic_beta_";
pub const WOW_CLASSIC_ERA_FOLDER: &str = "_classic_era_";
pub const WOW_CLASSIC_ERA_PTR_FOLDER: &str = "_classic_era_ptr_";
pub const WOW_CLASSIC_PTR_FOLDER: &str = "_classic_ptr_";
pub const WOW_RETAIL_PTR_FOLDER: &str = "_ptr_";
pub const WOW_RETAIL_XPTR_FOLDER: &str = "_xptr_";
pub const WOW_RETAIL_FOLDER: &str = "_retail_";
pub const WOW_ANNIVERSARY_FOLDER: &str = "_anniversary_";

pub const BLIZZARD_PRODUCT_DB_NAME: &str = "product.db";

/// Port of `getClientTypeForFolderName` (warcraft-platform.service.ts:32).
fn client_type_for_folder_name(folder_name: &str) -> WowClientType {
    match folder_name {
        WOW_RETAIL_FOLDER => WowClientType::Retail,
        WOW_RETAIL_PTR_FOLDER => WowClientType::RetailPtr,
        WOW_RETAIL_XPTR_FOLDER => WowClientType::RetailXPtr,
        WOW_CLASSIC_ERA_FOLDER => WowClientType::ClassicEra,
        WOW_CLASSIC_FOLDER => WowClientType::Classic,
        WOW_CLASSIC_PTR_FOLDER => WowClientType::ClassicPtr,
        WOW_BETA_FOLDER => WowClientType::Beta,
        WOW_CLASSIC_BETA_FOLDER => WowClientType::ClassicBeta,
        WOW_CLASSIC_ERA_PTR_FOLDER => WowClientType::ClassicEraPtr,
        WOW_ANNIVERSARY_FOLDER => WowClientType::Anniversary,
        _ => WowClientType::None,
    }
}

/// The `basename` the JS used via `path.basename`. `Path::file_name` is not equivalent on
/// Linux for a Windows-style path: product.db stores `C:\Program Files\...\Wow.exe`, and a
/// Linux build reading a Lutris prefix must still split on backslashes.
fn base_name(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

/// Port of `decodeProducts` (warcraft-platform.service.ts:63).
///
/// Returns an empty list rather than an error on a missing or corrupt file — the JS logged
/// and returned `[]`, and callers treat "no products" as "Battle.net not installed".
pub async fn decode_products(product_db_path: &str) -> Vec<InstalledProduct> {
    if product_db_path.is_empty() {
        return Vec::new();
    }

    let data = match tokio::fs::read(product_db_path).await {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to read product db at {product_db_path}: {e}");
            return Vec::new();
        }
    };

    let db = match product_db::ProductDb::decode(&data) {
        Ok(db) => db,
        Err(e) => {
            log::error!("Failed to decode product db at {product_db_path}: {e}");
            return Vec::new();
        }
    };

    db.products
        .into_iter()
        .filter(|p| p.family == "wow")
        .map(|p| InstalledProduct {
            location: p.client.location,
            client_type: client_type_for_folder_name(&p.client.name),
            name: p.client.name,
        })
        .filter(|p| {
            if p.client_type == WowClientType::None {
                log::warn!("Invalid client type detected: {p:?}");
                return false;
            }
            true
        })
        .collect()
}

pub async fn path_exists(p: impl AsRef<Path>) -> bool {
    tokio::fs::metadata(p).await.is_ok()
}

// ---------------------------------------------------------------------------
// Commands — one per IPC_WARCRAFT_* channel.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn warcraft_get_blizzard_agent_path() -> String {
    platform::get_blizzard_agent_path().await
}

/// Returns `[[clientType, product], …]` rather than a map object.
///
/// The renderer types this as `Map<WowClientType, InstalledProduct>` and calls `.get()` on
/// it. Electron's IPC uses structured clone, so a real `Map` survives the trip; Tauri's is
/// JSON, where it would arrive as `{}` — every lookup silently returning undefined, which
/// reads as "no WoW installed" rather than as an error.
///
/// Entry-pair form is what `new Map(…)` takes, and `new Map(someMap)` also copies a Map, so
/// the caller wraps the result once and both backends are correct. See warcraft-api.ts.
#[tauri::command]
pub async fn warcraft_get_installed_products(
    agent_path: String,
) -> Vec<(WowClientType, InstalledProduct)> {
    let decoded = decode_products(&agent_path).await;
    platform::resolve_products(decoded, &agent_path)
        .into_iter()
        .map(|p| (p.client_type, p))
        .collect()
}

#[tauri::command]
pub fn warcraft_get_executable_name(client_type: WowClientType) -> String {
    platform::get_executable_name(client_type)
}

#[tauri::command]
pub fn warcraft_get_client_type_for_binary(binary_path: String) -> WowClientType {
    platform::get_client_type(&binary_path)
}

#[tauri::command]
pub fn warcraft_is_wow_application(app_name: String) -> bool {
    platform::is_wow_application(&app_name)
}

#[tauri::command]
pub fn warcraft_get_executable_extension() -> String {
    platform::get_executable_extension().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_type_discriminants_match_the_typescript_enum() {
        // If this fails, every client type is silently remapped across IPC.
        assert_eq!(WowClientType::Retail as u8, 0);
        assert_eq!(WowClientType::Classic as u8, 1);
        assert_eq!(WowClientType::RetailPtr as u8, 2);
        assert_eq!(WowClientType::ClassicPtr as u8, 3);
        assert_eq!(WowClientType::Beta as u8, 4);
        assert_eq!(WowClientType::ClassicBeta as u8, 5);
        assert_eq!(WowClientType::ClassicEra as u8, 6);
        assert_eq!(WowClientType::ClassicEraPtr as u8, 7);
        assert_eq!(WowClientType::RetailXPtr as u8, 8);
        assert_eq!(WowClientType::Anniversary as u8, 9);
        assert_eq!(WowClientType::None as u8, 10);
    }

    #[test]
    fn client_type_serializes_as_a_bare_number() {
        // The renderer compares against a numeric TS enum, not a tagged union.
        assert_eq!(
            serde_json::to_string(&WowClientType::ClassicEra).unwrap(),
            "6"
        );
    }

    #[test]
    fn installed_product_serializes_as_camel_case() {
        let p = InstalledProduct {
            name: "_retail_".into(),
            location: "/wow".into(),
            client_type: WowClientType::Retail,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"clientType\":0"), "got {json}");
    }

    #[test]
    fn maps_every_known_folder_name() {
        assert_eq!(
            client_type_for_folder_name("_retail_"),
            WowClientType::Retail
        );
        assert_eq!(
            client_type_for_folder_name("_ptr_"),
            WowClientType::RetailPtr
        );
        assert_eq!(
            client_type_for_folder_name("_xptr_"),
            WowClientType::RetailXPtr
        );
        assert_eq!(
            client_type_for_folder_name("_classic_"),
            WowClientType::Classic
        );
        assert_eq!(
            client_type_for_folder_name("_classic_era_"),
            WowClientType::ClassicEra
        );
        assert_eq!(
            client_type_for_folder_name("_classic_era_ptr_"),
            WowClientType::ClassicEraPtr
        );
        assert_eq!(
            client_type_for_folder_name("_classic_ptr_"),
            WowClientType::ClassicPtr
        );
        assert_eq!(client_type_for_folder_name("_beta_"), WowClientType::Beta);
        assert_eq!(
            client_type_for_folder_name("_classic_beta_"),
            WowClientType::ClassicBeta
        );
        assert_eq!(
            client_type_for_folder_name("_anniversary_"),
            WowClientType::Anniversary
        );
        assert_eq!(
            client_type_for_folder_name("_nonsense_"),
            WowClientType::None
        );
    }

    /// product.db holds Windows paths even when WowUp runs on Linux under Lutris, so
    /// basename must split on both separators regardless of host platform.
    #[test]
    fn base_name_handles_both_separators() {
        assert_eq!(base_name("C:\\Program Files\\WoW\\Wow.exe"), "Wow.exe");
        assert_eq!(base_name("/home/u/wow/Wow.exe"), "Wow.exe");
        assert_eq!(base_name("Wow.exe"), "Wow.exe");
    }

    #[tokio::test]
    async fn decode_products_returns_empty_for_blank_path() {
        assert!(decode_products("").await.is_empty());
    }

    #[tokio::test]
    async fn decode_products_returns_empty_for_missing_file() {
        assert!(decode_products("/nonexistent/product.db").await.is_empty());
    }
}
