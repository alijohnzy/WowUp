//! The addon database — port of `app/controllers/addon.controller.ts`.
//!
//! Backed by the `addons` store (see store.rs), keyed by `addon.id`. Every query below is a
//! linear scan, as it was in the Electron build; `plugin-sql` is the eventual answer (see
//! migration/tauri-scope.md Group E) but changing the storage engine and the process
//! boundary in one step would make a regression impossible to attribute.
//!
//! Addons are handled as `serde_json::Value`, not a typed struct. That is deliberate:
//! `saveAll` round-trips whatever the renderer sends, and a partial struct would silently
//! drop every field it did not declare — of which `Addon` has around forty.

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::store::{Stores, ADDON_STORE_NAME};

fn field<'a>(addon: &'a Value, key: &str) -> Option<&'a str> {
    addon.get(key).and_then(Value::as_str)
}

fn is_ignored(addon: &Value) -> bool {
    // `a.isIgnored !== true` in the original — anything other than boolean true counts as
    // not ignored, including a missing field.
    addon.get("isIgnored") == Some(&Value::Bool(true))
}

/// `.replace(/^v/i, "")` — strips a single leading v/V. Release tags like `v1.2.3` are
/// common and inconsistent between providers; without this every such addon would read as
/// permanently updatable.
fn strip_leading_v(s: &str) -> &str {
    s.strip_prefix('v').or_else(|| s.strip_prefix('V')).unwrap_or(s)
}

/// Port of `needsUpdate` (addon.controller.ts:104).
fn needs_update(addon: &Value) -> bool {
    if is_ignored(addon) {
        return false;
    }

    let latest_release = field(addon, "externalLatestReleaseId");
    let installed_release = field(addon, "installedExternalReleaseId");
    // The JS checks `externalLatestReleaseId &&` first, so an empty string is falsy and
    // falls through to the version comparison rather than reporting an update.
    if let Some(latest) = latest_release.filter(|s| !s.is_empty()) {
        if Some(latest) != installed_release {
            return true;
        }
    }

    let installed = strip_leading_v(field(addon, "installedVersion").unwrap_or(""));
    let latest = strip_leading_v(field(addon, "latestVersion").unwrap_or(""));

    !installed.is_empty() && installed != latest
}

fn all_addons(app: &AppHandle, stores: &Stores) -> Result<Vec<Value>, String> {
    stores.values(app, ADDON_STORE_NAME)
}

#[tauri::command]
pub fn addons_get_all(app: AppHandle, stores: State<'_, Stores>) -> Result<Vec<Value>, String> {
    all_addons(&app, &stores)
}

#[tauri::command]
pub fn addons_get_all_for_installation(
    app: AppHandle,
    stores: State<'_, Stores>,
    installation_id: String,
) -> Result<Vec<Value>, String> {
    Ok(all_addons(&app, &stores)?
        .into_iter()
        .filter(|a| field(a, "installationId") == Some(installation_id.as_str()))
        .collect())
}

#[tauri::command]
pub fn addons_get_all_for_provider(
    app: AppHandle,
    stores: State<'_, Stores>,
    provider_name: String,
) -> Result<Vec<Value>, String> {
    Ok(all_addons(&app, &stores)?
        .into_iter()
        .filter(|a| field(a, "providerName") == Some(provider_name.as_str()))
        .collect())
}

#[tauri::command]
pub fn addons_get_by_external_id(
    app: AppHandle,
    stores: State<'_, Stores>,
    external_id: String,
    provider_name: String,
    installation_id: String,
) -> Result<Option<Value>, String> {
    Ok(all_addons(&app, &stores)?.into_iter().find(|a| {
        field(a, "installationId") == Some(installation_id.as_str())
            && field(a, "externalId") == Some(external_id.as_str())
            && field(a, "providerName") == Some(provider_name.as_str())
    }))
}

#[tauri::command]
pub fn addons_get_by_external_ids(
    app: AppHandle,
    stores: State<'_, Stores>,
    external_ids: Vec<String>,
) -> Result<Vec<Value>, String> {
    Ok(all_addons(&app, &stores)?
        .into_iter()
        .filter(|a| match field(a, "externalId") {
            // `a.externalId &&` — an empty id never matches, even against an empty needle.
            Some(id) if !id.is_empty() => external_ids.iter().any(|w| w == id),
            _ => false,
        })
        .collect())
}

#[tauri::command]
pub fn addons_get_available_for_update(
    app: AppHandle,
    stores: State<'_, Stores>,
    installation_id: Option<String>,
) -> Result<Vec<Value>, String> {
    Ok(all_addons(&app, &stores)?
        .into_iter()
        .filter(|a| {
            // An absent installationId means "across all installations".
            if let Some(id) = installation_id.as_deref() {
                if field(a, "installationId") != Some(id) {
                    return false;
                }
            }
            !is_ignored(a) && needs_update(a)
        })
        .collect())
}

#[tauri::command]
pub fn addons_get_auto_update_enabled(
    app: AppHandle,
    stores: State<'_, Stores>,
) -> Result<Vec<Value>, String> {
    Ok(all_addons(&app, &stores)?
        .into_iter()
        .filter(|a| {
            !is_ignored(a)
                && a.get("autoUpdateEnabled") == Some(&Value::Bool(true))
                && field(a, "installationId").is_some_and(|s| !s.is_empty())
        })
        .collect())
}

#[tauri::command]
pub fn addons_save_all(
    app: AppHandle,
    stores: State<'_, Stores>,
    addons: Vec<Value>,
) -> Result<(), String> {
    let mut entries = Vec::new();
    for addon in addons {
        match field(&addon, "id") {
            Some(id) => entries.push((id.to_string(), addon)),
            None => log::warn!("malformed addon not saved: {addon}"),
        }
    }
    // One write for the batch rather than per addon — a full sync saves hundreds.
    stores.set_many(&app, ADDON_STORE_NAME, entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn release_id_mismatch_means_an_update() {
        assert!(needs_update(&json!({
            "externalLatestReleaseId": "200",
            "installedExternalReleaseId": "100"
        })));
    }

    #[test]
    fn matching_release_ids_fall_through_to_versions() {
        assert!(!needs_update(&json!({
            "externalLatestReleaseId": "100",
            "installedExternalReleaseId": "100",
            "installedVersion": "1.0.0",
            "latestVersion": "1.0.0"
        })));
    }

    #[test]
    fn a_leading_v_is_not_a_version_difference() {
        // Providers are inconsistent about the prefix; without stripping it, every addon
        // tagged v1.2.3 would show as permanently updatable.
        assert!(!needs_update(&json!({
            "installedVersion": "v1.2.3",
            "latestVersion": "1.2.3"
        })));
        assert!(needs_update(&json!({
            "installedVersion": "v1.2.3",
            "latestVersion": "1.2.4"
        })));
    }

    #[test]
    fn an_addon_with_no_installed_version_is_not_updatable() {
        // Otherwise a freshly-scanned folder with no version reads as needing an update.
        assert!(!needs_update(&json!({ "latestVersion": "1.0.0" })));
        assert!(!needs_update(&json!({ "installedVersion": "", "latestVersion": "1.0.0" })));
    }

    #[test]
    fn an_ignored_addon_never_needs_an_update() {
        assert!(!needs_update(&json!({
            "isIgnored": true,
            "installedVersion": "1.0.0",
            "latestVersion": "2.0.0"
        })));
    }

    #[test]
    fn an_empty_latest_release_id_falls_through_rather_than_reporting_an_update() {
        // `externalLatestReleaseId &&` is falsy for "", so the JS skips the comparison.
        assert!(!needs_update(&json!({
            "externalLatestReleaseId": "",
            "installedExternalReleaseId": "100",
            "installedVersion": "1.0.0",
            "latestVersion": "1.0.0"
        })));
    }

    #[test]
    fn is_ignored_only_treats_boolean_true_as_ignored() {
        assert!(is_ignored(&json!({ "isIgnored": true })));
        assert!(!is_ignored(&json!({ "isIgnored": false })));
        assert!(!is_ignored(&json!({ "isIgnored": "true" })));
        assert!(!is_ignored(&json!({})));
    }
}
