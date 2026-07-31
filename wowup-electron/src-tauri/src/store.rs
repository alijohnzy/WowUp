//! Key/value stores — port of `app/stores.ts` (electron-store).
//!
//! Three stores (`addons`, `preferences`, `sensitive`), each a flat JSON object in the app
//! data directory, which is the same on-disk shape electron-store uses. Kept deliberately:
//! it leaves the door open to reading an existing Electron install's files, and there is
//! nothing here that a store plugin would do better.
//!
//! The one behaviour worth being careful about is in `set` — see `coerce_for_storage`.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub const ADDON_STORE_NAME: &str = "addons";
pub const PREFERENCE_STORE_NAME: &str = "preferences";
pub const SENSITIVE_STORE_NAME: &str = "sensitive";

/// `COLLAPSE_TO_TRAY_PREFERENCE_KEY` in src/common/constants.ts:136.
pub const COLLAPSE_TO_TRAY_PREFERENCE_KEY: &str = "collapse_to_tray";

const STORE_NAMES: [&str; 3] = [
    ADDON_STORE_NAME,
    PREFERENCE_STORE_NAME,
    SENSITIVE_STORE_NAME,
];

#[derive(Default)]
pub struct Stores {
    /// store name -> contents. Loaded on first touch, held in memory thereafter, exactly as
    /// electron-store does.
    inner: Mutex<HashMap<String, Map<String, Value>>>,
}

/// Port of the coercion in `app/stores.ts:60`:
///
/// ```js
/// let storedVal = value.toString();
/// if (typeof value === "object" || Array.isArray(value)) storedVal = value;
/// ```
///
/// So objects and arrays are stored structurally and **everything else is stringified** —
/// `true` persists as `"true"`, `5` as `"5"`. That is not incidental: `storage.getBool()`
/// compares the value against the literal `'true'` (`TRUE_STR`), so storing a JSON boolean
/// here would make every boolean preference read as false. The E2E harness seeds
/// `enable_system_notifications: 'true'` as a string for the same reason.
///
/// `null` deviates: JS would throw on `null.toString()`, so the Electron build cannot store
/// one at all. Stringifying to `"null"` keeps that from being a panic.
fn coerce_for_storage(value: Value) -> Value {
    match value {
        Value::Object(_) | Value::Array(_) => value,
        Value::String(s) => Value::String(s),
        Value::Bool(b) => Value::String(b.to_string()),
        Value::Number(n) => Value::String(n.to_string()),
        Value::Null => Value::String("null".to_string()),
    }
}

impl Stores {
    fn path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data dir: {e}"))?;
        Ok(dir.join(format!("{name}.json")))
    }

    fn load(path: &Path) -> Map<String, Value> {
        // A missing file is the first run. A corrupt one is logged and treated as empty
        // rather than fatal — losing preferences beats refusing to start, which is what
        // electron-store does too.
        match std::fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(map)) => map,
                Ok(_) => {
                    log::warn!("{} is not a JSON object; ignoring", path.display());
                    Map::new()
                }
                Err(e) => {
                    log::error!("{} is not valid JSON ({e}); ignoring", path.display());
                    Map::new()
                }
            },
            Err(_) => Map::new(),
        }
    }

    fn persist(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Write-then-rename: a crash mid-write would otherwise leave a truncated file, and
        // the store holds the WoW installation list.
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    fn with<T>(
        &self,
        app: &AppHandle,
        name: &str,
        f: impl FnOnce(&mut Map<String, Value>) -> T,
    ) -> Result<T, String> {
        if !STORE_NAMES.contains(&name) {
            // The Electron build silently no-ops on an unknown store name. Reporting it is
            // strictly better: it is always a typo.
            return Err(format!("unknown store \"{name}\""));
        }

        let path = Self::path(app, name)?;
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let map = guard
            .entry(name.to_string())
            .or_insert_with(|| Self::load(&path));
        Ok(f(map))
    }
}

impl Stores {
    /// A single value, for Rust-side callers such as the close-to-tray check.
    pub fn get(&self, app: &AppHandle, name: &str, key: &str) -> Result<Option<Value>, String> {
        self.with(app, name, |map| map.get(key).cloned())
    }

    /// All values in a store — used by the addon queries, which scan rather than key-lookup.
    pub fn values(&self, app: &AppHandle, name: &str) -> Result<Vec<Value>, String> {
        self.with(app, name, |map| map.values().cloned().collect())
    }

    /// Insert many keys and persist once. Stored verbatim: addons are objects, so the
    /// `coerce_for_storage` stringification does not apply to them.
    pub fn set_many(
        &self,
        app: &AppHandle,
        name: &str,
        entries: Vec<(String, Value)>,
    ) -> Result<(), String> {
        let path = Self::path(app, name)?;
        let snapshot = self.with(app, name, |map| {
            for (k, v) in entries {
                map.insert(k, v);
            }
            map.clone()
        })?;
        Self::persist(&path, &snapshot)
    }
}

#[tauri::command]
pub fn store_get_object(
    app: AppHandle,
    stores: State<'_, Stores>,
    store_name: String,
    key: String,
) -> Result<Option<Value>, String> {
    stores.with(&app, &store_name, |map| map.get(&key).cloned())
}

/// Returns the store's **values**, not its entries — `app/stores.ts:37` pushes `result[1]`.
#[tauri::command]
pub fn store_get_all(
    app: AppHandle,
    stores: State<'_, Stores>,
    store_name: String,
) -> Result<Vec<Value>, String> {
    stores.with(&app, &store_name, |map| map.values().cloned().collect())
}

#[tauri::command]
pub fn store_set_object(
    app: AppHandle,
    stores: State<'_, Stores>,
    store_name: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    let path = Stores::path(&app, &store_name)?;
    let snapshot = stores.with(&app, &store_name, |map| {
        map.insert(key, coerce_for_storage(value));
        map.clone()
    })?;
    Stores::persist(&path, &snapshot)
}

#[tauri::command]
pub fn store_remove_object(
    app: AppHandle,
    stores: State<'_, Stores>,
    store_name: String,
    key: String,
) -> Result<(), String> {
    let path = Stores::path(&app, &store_name)?;
    let snapshot = stores.with(&app, &store_name, |map| {
        map.remove(&key);
        map.clone()
    })?;
    Stores::persist(&path, &snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn primitives_are_stringified_the_way_electron_store_stringifies_them() {
        // getBool() compares against the literal 'true', so a JSON boolean here would make
        // every boolean preference read as false.
        assert_eq!(coerce_for_storage(json!(true)), json!("true"));
        assert_eq!(coerce_for_storage(json!(false)), json!("false"));
        assert_eq!(coerce_for_storage(json!(5)), json!("5"));
        assert_eq!(coerce_for_storage(json!(5.5)), json!("5.5"));
        assert_eq!(coerce_for_storage(json!("already")), json!("already"));
    }

    #[test]
    fn objects_and_arrays_are_stored_structurally() {
        // wow_installations and addon_providers are arrays of objects; stringifying them
        // would make the renderer parse "[object Object]".
        assert_eq!(coerce_for_storage(json!({"a": 1})), json!({"a": 1}));
        assert_eq!(coerce_for_storage(json!([1, 2])), json!([1, 2]));
        assert_eq!(
            coerce_for_storage(json!([{"id": "x"}])),
            json!([{"id": "x"}])
        );
    }

    #[test]
    fn null_does_not_panic() {
        assert_eq!(coerce_for_storage(json!(null)), json!("null"));
    }

    #[test]
    fn load_tolerates_missing_and_corrupt_files() {
        let dir = std::env::temp_dir().join("wowup-store-test");
        std::fs::create_dir_all(&dir).unwrap();

        let missing = dir.join("nope.json");
        let _ = std::fs::remove_file(&missing);
        assert!(Stores::load(&missing).is_empty());

        let corrupt = dir.join("corrupt.json");
        std::fs::write(&corrupt, "{not json").unwrap();
        assert!(Stores::load(&corrupt).is_empty());

        let wrong_shape = dir.join("array.json");
        std::fs::write(&wrong_shape, "[1,2,3]").unwrap();
        assert!(Stores::load(&wrong_shape).is_empty());
    }

    #[test]
    fn persist_then_load_round_trips() {
        let dir = std::env::temp_dir().join("wowup-store-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("round.json");

        let mut map = Map::new();
        map.insert("theme".into(), json!("horde-dark"));
        map.insert("wow_installations".into(), json!([{"id": "a"}]));
        Stores::persist(&path, &map).unwrap();

        let loaded = Stores::load(&path);
        assert_eq!(loaded.get("theme").unwrap(), &json!("horde-dark"));
        assert_eq!(
            loaded.get("wow_installations").unwrap(),
            &json!([{"id": "a"}])
        );
    }

    #[test]
    fn persist_leaves_no_temp_file_behind() {
        let dir = std::env::temp_dir().join("wowup-store-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tmpcheck.json");
        Stores::persist(&path, &Map::new()).unwrap();
        assert!(!path.with_extension("json.tmp").exists());
    }
}
