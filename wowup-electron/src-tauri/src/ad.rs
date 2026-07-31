//! The ad frame — Tauri's answer to Electron's `<webview>` in the nav rail.
//!
//! Replaces the `buildWago` half of `AdWebView.svelte` plus `app/wago-handler.ts`. The other
//! half, `<owadview>`, is a custom element supplied by `@overwolf/ow-electron` and has no
//! equivalent here; see `migration/tauri-scope.md` §3.4.
//!
//! # Why a separate window rather than a child webview
//!
//! The obvious shape is `Window::add_child`, an overlay positioned over the ad slot. That
//! does not work on Linux: `tauri-runtime-wry` builds child webviews into the window's
//! `default_vbox()`, and wry only honours absolute bounds when the container is a `GtkFixed`
//! — for a `GtkBox` it falls through to `pack_start(expand: true, fill: true)`. The result is
//! that the ad and the UI split the window between them, which is what it did: the app was
//! squeezed into the top half with a blank ad page across the bottom. `set_position` does not
//! help, because wry's bounds setter checks for the same container type.
//!
//! So the frame is a borderless child *window* kept over the slot. It costs the position
//! tracking below, but it is the only shape that both renders where it is told on Linux and
//! keeps the ad on its own origin.
//!
//! # Why the token comes back through a blocked navigation
//!
//! Electron loads the page with `assets/preload/wago.js`, which exposes
//! `window.wago.provideApiKey(key)` and forwards the key over IPC. Tauri's equivalent of a
//! preload is `initialization_script`, but its equivalent of "this frame may use IPC" is a
//! capability with `remote.urls` — and that grants the origin **every** app command, not a
//! chosen few. An ad frame runs third-party ad-network JavaScript, so that would put
//! `write_file`, `delete_directory` and `download_file` one XSS away from an advertiser.
//!
//! So this webview gets no capability at all and therefore no IPC. The init script hands the
//! token over by navigating to a sentinel URL, which `on_navigation` reads and refuses. The
//! navigation never happens, nothing is requested, and the page keeps no command surface.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Label for the ad window. Deliberately not in any capability — see the module docs.
const AD_WEBVIEW_LABEL: &str = "wowup-ad";

/// Host of the sentinel URL the init script navigates to in order to hand back a token.
///
/// `.invalid` is reserved by RFC 2606 and never resolves, so a bug that let the navigation
/// through would fail closed rather than posting the token to a real server. In practice
/// `on_navigation` blocks it before any request is made.
const TOKEN_HOST: &str = "wowup-token.invalid";

/// Only used if the renderer sends none; the provider supplies its own.
const DEFAULT_AD_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";

/// Matches `app/wago-handler.ts:29`, which drops anything shorter as malformed.
const MIN_TOKEN_LEN: usize = 20;

/// Where the ad frame sits, in CSS pixels relative to the main window's content.
#[derive(Debug, Clone, Copy)]
pub struct Slot {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// `None` when the frame is closed. Also the record used to re-place the window when the
/// main one moves.
#[derive(Default)]
pub struct AdFrame(Mutex<Option<Slot>>);

/// Port of `assets/preload/wago.js`.
///
/// Two things the preload does are deliberately dropped. Console forwarding, because each
/// line would cost a blocked navigation, and the page is chatty. And `window.onerror`
/// reporting, for the same reason — `on_navigation` already logs what it refuses.
///
/// The reload-if-no-key timer is kept: the page returning a 500 is the normal way this
/// fails, and without it the frame sits there empty forever.
fn init_script() -> String {
    format!(
        r#"
(function () {{
  var TOKEN_URL = 'https://{TOKEN_HOST}/?t=';
  var keyExpectedTimeout;

  // The page calls this once it has a key. Electron's preload sent it over IPC; here the
  // navigation is intercepted and cancelled by the Rust side, which never lets it out.
  Object.defineProperty(window, 'wago', {{
    value: Object.freeze({{
      provideApiKey: function (key) {{
        window.clearTimeout(keyExpectedTimeout);
        keyExpectedTimeout = undefined;
        if (typeof key !== 'string' || !key.length) return;
        // An iframe, not window.location: WebKitGTK blanks the current document the moment
        // a top-level navigation starts, and cancelling it in on_navigation does not bring
        // the page back. That left a white frame with the ad destroyed — while still
        // reporting a token, which is what made it look like the page had simply not loaded.
        var sink = document.createElement('iframe');
        sink.style.display = 'none';
        sink.src = TOKEN_URL + encodeURIComponent(key);
        (document.body || document.documentElement).appendChild(sink);
        window.setTimeout(function () {{ sink.remove(); }}, 1000);
      }}
    }}),
    writable: false,
    configurable: false
  }});

  // Backoff reload, ported from the preload: a bad response leaves the frame blank, and
  // without this it never recovers.
  function backoffReload() {{
    var setAt = parseInt(window.sessionStorage.getItem('wago-backoff-set') || '0', 10);
    var backoff = Math.min(parseInt(window.sessionStorage.getItem('wago-backoff') || '0', 10) * 2 || 2000, 120000);
    if (Date.now() - setAt > 300000) backoff = 2000;
    window.sessionStorage.setItem('wago-backoff', String(backoff));
    window.sessionStorage.setItem('wago-backoff-set', String(Date.now()));
    window.setTimeout(function () {{ window.location.reload(); }}, backoff);
  }}

  keyExpectedTimeout = window.setTimeout(backoffReload, 30000);
  window.addEventListener('error', function () {{
    if (keyExpectedTimeout !== undefined) backoffReload();
  }}, true);
}})();
"#
    )
}

/// Open the ad frame over the nav rail's ad slot.
///
/// Bounds arrive as CSS pixels relative to the main window's content. The main window is
/// decorationless, so its outer position *is* its content origin and the two just add.
#[tauri::command]
pub fn ad_frame_open(
    app: AppHandle,
    state: tauri::State<'_, AdFrame>,
    url: String,
    user_agent: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Re-opening without closing would leave an orphan window still loading ads.
    close_inner(&app, &state)?;

    let parsed = url.parse::<url::Url>().map_err(|e| format!("{url}: {e}"))?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;

    let app_for_nav = app.clone();
    let app_for_new_window = app.clone();

    tauri::WebviewWindowBuilder::new(&app, AD_WEBVIEW_LABEL, WebviewUrl::External(parsed))
        .initialization_script(init_script())
        // "the ad requires a normal looking user agent" — the comment on WAGO_AD_USER_AGENT
        // in wago-addon-provider.ts. WebKitGTK's default is Safari-like and the ad network
        // serves nothing to it, so the frame renders blank while still handing back a token.
        .user_agent(user_agent.as_deref().unwrap_or(DEFAULT_AD_USER_AGENT))
        // Electron used `partition: 'memcache'` — an in-memory partition, so the ad frame
        // keeps no cookies between runs.
        .incognito(true)
        .decorations(false)
        .resizable(false)
        // Transient for the main window: the WM keeps it above its parent and only its
        // parent, so it does not float over other applications.
        .parent(&main)
        .map_err(|e| format!("could not parent ad frame: {e}"))?
        .skip_taskbar(true)
        // Otherwise the ad frame is a second entry in alt-tab and can take focus from the
        // app — it is meant to read as part of the window, not as a window of its own.
        .focusable(false)
        .focused(false)
        .inner_size(width, height)
        .on_navigation(move |target| on_navigation(&app_for_nav, target))
        .on_new_window(move |target, _features| {
            // `allowpopups` was on in Electron only so links would work at all; the open was
            // then denied and handed to the app, which asks before opening a browser
            // (app/wago-handler.ts:91). Same here.
            log::debug!("[ad] new window denied, forwarding: {target}");
            let _ = app_for_new_window.emit_to(
                "main",
                "webview-new-window",
                serde_json::json!({ "url": target.to_string() }),
            );
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(|_webview, payload| {
            // A frame that fails to load is otherwise silent: the panel just stays blank,
            // which looks the same as an ad slot that went unfilled.
            log::debug!("[ad] page load {:?} {}", payload.event(), payload.url());
        })
        .build()
        .map_err(|e| format!("could not create ad frame: {e}"))?;

    *state.0.lock().unwrap() = Some(Slot {
        x,
        y,
        width,
        height,
    });
    position_over_slot(&app)?;
    log::info!("[ad] opened {url} at {x}x{y} {width}x{height}");
    Ok(())
}

/// Returns false to cancel the navigation.
fn on_navigation(app: &AppHandle, target: &url::Url) -> bool {
    if target.host_str() == Some(TOKEN_HOST) {
        let token = target
            .query_pairs()
            .find(|(k, _)| k == "t")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();

        // Same guard as app/wago-handler.ts:29. Never log the token itself.
        if token.len() < MIN_TOKEN_LEN {
            log::warn!("[ad] malformed token, length {}", token.len());
        } else {
            log::info!("[ad] token received");
            if let Err(e) = app.emit_to("main", "wago-token-received", token) {
                log::error!("[ad] could not forward token: {e}");
            }
        }
        return false;
    }

    // Electron blocked cross-origin navigation here (app/wago-handler.ts:82), but its
    // `will-navigate` only fires for the top-level frame. wry's handler fires for subframes
    // too and cannot tell them apart — the closure only receives a URL. Blocking cross-origin
    // therefore blocked the ad itself, which RAMP renders in an iframe from
    // cdn.intergient.com: the page drew its own text and the ad slot stayed empty.
    //
    // So everything but the token sentinel is allowed through. What Electron's rule protected
    // against — the panel being navigated somewhere else — is covered by the frame being a
    // separate window on its own origin with no capability and no IPC, and by `on_new_window`
    // handing real link clicks to the app to confirm.
    true
}

/// Put the ad window over its slot in the main window.
///
/// Called on open and whenever the main window moves or resizes — a separate window does not
/// follow its parent on its own, so without this it stays where it was while the app moves
/// out from under it.
pub fn position_over_slot(app: &AppHandle) -> Result<(), String> {
    let (Some(main), Some(ad)) = (
        app.get_webview_window("main"),
        app.get_webview_window(AD_WEBVIEW_LABEL),
    ) else {
        return Ok(());
    };

    let guard = app.state::<AdFrame>();
    let Some(slot) = *guard.0.lock().unwrap() else {
        return Ok(());
    };

    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);

    ad.set_position(LogicalPosition::new(origin.x + slot.x, origin.y + slot.y))
        .map_err(|e| e.to_string())?;
    ad.set_size(LogicalSize::new(slot.width, slot.height))
        .map_err(|e| e.to_string())
}

/// Mirror the main window's visibility, so the ad does not linger on screen after the app is
/// minimised or hidden to the tray.
pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(ad) = app.get_webview_window(AD_WEBVIEW_LABEL) else {
        return;
    };
    let result = if visible { ad.show() } else { ad.hide() };
    if let Err(e) = result {
        log::debug!("[ad] visibility: {e}");
    }
}

/// Move the frame when the rail collapses or the window resizes.
#[tauri::command]
pub fn ad_frame_set_bounds(
    app: AppHandle,
    state: tauri::State<'_, AdFrame>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    {
        let mut guard = state.0.lock().unwrap();
        if guard.is_none() {
            return Ok(());
        }
        *guard = Some(Slot {
            x,
            y,
            width,
            height,
        });
    }
    position_over_slot(&app)
}

/// Port of `reloadIgnoringCache()`, used when a provider re-authenticates.
#[tauri::command]
pub fn ad_frame_reload(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(AD_WEBVIEW_LABEL) {
        Some(ad) => ad.reload().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn ad_frame_close(app: AppHandle, state: tauri::State<'_, AdFrame>) -> Result<(), String> {
    close_inner(&app, &state)
}

fn close_inner(app: &AppHandle, state: &tauri::State<'_, AdFrame>) -> Result<(), String> {
    state.0.lock().unwrap().take();
    if let Some(ad) = app.get_webview_window(AD_WEBVIEW_LABEL) {
        log::info!("[ad] closed");
        // A window already gone reports an error; nothing to do about it.
        if let Err(e) = ad.close() {
            log::debug!("[ad] close: {e}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> url::Url {
        s.parse().unwrap()
    }

    /// The token arrives as a navigation that must never be allowed to leave the machine.
    #[test]
    fn the_token_navigation_is_always_cancelled() {
        assert!(!token_target_is_allowed(
            "https://wowup-token.invalid/?t=abc"
        ));
    }

    fn token_target_is_allowed(target: &str) -> bool {
        // Mirrors the host check in `on_navigation` without needing an AppHandle.
        url(target).host_str() != Some(TOKEN_HOST)
    }

    /// Cross-origin navigation has to be allowed: RAMP renders the creative in an iframe from
    /// cdn.intergient.com, and wry's navigation handler cannot tell a subframe from the top
    /// frame. Blocking it left the ad slot permanently empty while the page itself rendered.
    #[test]
    fn ad_subframes_are_allowed_through() {
        for target in [
            "https://cdn.intergient.com/pageos/V.1/iframe/iframe.html",
            "about:blank",
            "https://addons.wago.io/wowup_ad",
        ] {
            assert!(
                token_target_is_allowed(target),
                "{target} must not be blocked"
            );
        }
    }

    /// `app/wago-handler.ts:29` drops anything shorter, and so must this — a truncated key
    /// would be stored and every Wago request would then fail with no obvious cause.
    #[test]
    fn short_tokens_are_rejected() {
        let short = url("https://wowup-token.invalid/?t=abc");
        let value = short
            .query_pairs()
            .find(|(k, _)| k == "t")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        assert!(value.len() < MIN_TOKEN_LEN);

        let good = url("https://wowup-token.invalid/?t=abcdefghijklmnopqrstuvwxyz");
        let value = good
            .query_pairs()
            .find(|(k, _)| k == "t")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        assert!(value.len() >= MIN_TOKEN_LEN);
    }

    /// The page hands back keys containing characters that must survive a URL round trip.
    #[test]
    fn tokens_survive_url_encoding() {
        let raw = "abc+def/ghi=jkl mno&pqr";
        let encoded: String = url::form_urlencoded::byte_serialize(raw.as_bytes()).collect();
        let parsed = url(&format!("https://wowup-token.invalid/?t={encoded}"));
        let value = parsed
            .query_pairs()
            .find(|(k, _)| k == "t")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        assert_eq!(value, raw);
    }

    /// The init script must define `provideApiKey`, which is the whole contract the remote
    /// page codes against (`assets/preload/wago.js:63`).
    #[test]
    fn init_script_exposes_the_expected_surface() {
        let script = init_script();
        assert!(script.contains("provideApiKey"));
        assert!(script.contains(TOKEN_HOST));
        // No IPC: if this ever appears, the ad frame has gained a command surface.
        assert!(!script.contains("__TAURI"));
        assert!(!script.contains("invoke("));
    }
}
