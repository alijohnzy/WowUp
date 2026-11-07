//! The Wago ad as a native webview laid over the nav rail's ad slot (`ad-view-*` channels).
//!
//! # Why not the iframe
//!
//! The ad used to be an `<iframe>` of a copy of Wago's page that `ad.rs` served from the app's
//! own scheme, because `addons.wago.io` answers with `X-Frame-Options: SAMEORIGIN`. The page
//! ran and handed over its API key, but the ad slot never filled: ad networks authorise by the
//! page's domain, and a copy on `wowupad://localhost` is not `addons.wago.io`. Measured in
//! WebKitGTK's MiniBrowser with the same page: at its real URL it filled a 300x250 creative on
//! the first load; re-served from another origin it stayed the empty dark box the app showed.
//!
//! So, like upstream's Electron build (a `WebContentsView`, app/services/ads/), the page is
//! loaded at its real URL in a webview of its own, positioned over the slot the renderer
//! reports. It draws above the app's DOM, so the renderer hides it while a dialog is open.
//!
//! # The key
//!
//! Wago's page calls `wago.provideApiKey(key)` inline; the initialization script below defines
//! it and passes the key on over wry's own IPC channel (`window.ipc.postMessage`), which only
//! reaches the handler here — the page gets no access to the app's commands. The page reloads
//! itself every few minutes to renew the key, so the view must stay loaded even when hidden.
//!
//! # Platforms
//!
//! Windows: a child webview positioned with `set_bounds`. Linux: Tauri 2.11 puts child webviews
//! in the window's vertical box, which stacks them under the page instead of over it
//! (tauri-apps/tauri#10420), so `install_overlay` wraps that box in a `gtk::Overlay` at startup,
//! and the ad lives in a holder on the overlay layer. Elsewhere there is no ad view.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

/// The page Wago serves the ad and the API key on (upstream src/app/addon-providers/
/// wago-addon-provider.ts uses the same one since "Move to new Wago ads solution").
pub const AD_URL: &str = "https://addons.wago.io/wowup_ad_nitro";
const WAGO_HOST: &str = "addons.wago.io";

/// Same event the iframe's postMessage bridge emitted; the Wago provider listens for it.
const EVT_TOKEN: &str = "wago-token-received";
/// A link the ad wants to open; the renderer confirms it and opens it in the browser.
const EVT_LINK: &str = "ad-view-link";

/// Where the ad slot is, in logical pixels relative to the window's content area, and whether
/// it should be drawn (it is hidden, not unloaded, while dialogs are open).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

impl AdBounds {
    fn drawable(&self) -> bool {
        self.visible && self.width >= 1.0 && self.height >= 1.0
    }
}

/// Defines `window.wago` before the page's inline script calls it, and keeps the reload-on-no-
/// key timer the Electron preload (assets/preload/wago.js) had: when the page answers without
/// a key, reloading with backoff is how it recovers.
const INIT_SCRIPT: &str = r#"
(function () {
  var keyExpectedTimeout;

  Object.defineProperty(window, 'wago', {
    value: Object.freeze({
      provideApiKey: function (key) {
        window.clearTimeout(keyExpectedTimeout);
        keyExpectedTimeout = undefined;
        if (typeof key === 'string' && key.length) {
          window.ipc.postMessage(JSON.stringify({ type: 'token', token: key }));
        }
      }
    }),
    writable: false,
    configurable: false
  });

  function backoffReload() {
    var setAt = parseInt(window.sessionStorage.getItem('wago-backoff-set') || '0', 10);
    var backoff = Math.min(parseInt(window.sessionStorage.getItem('wago-backoff') || '0', 10) * 2 || 2000, 120000);
    if (Date.now() - setAt > 300000) backoff = 2000;
    window.sessionStorage.setItem('wago-backoff', String(backoff));
    window.sessionStorage.setItem('wago-backoff-set', String(Date.now()));
    window.setTimeout(function () { window.location.reload(); }, backoff);
  }

  keyExpectedTimeout = window.setTimeout(backoffReload, 30000);

  // The slot shows the 300x250 creative; the page continues with Wago's own description,
  // which would otherwise make the slot scrollable.
  document.addEventListener('DOMContentLoaded', function () {
    var style = document.createElement('style');
    style.textContent = 'html, body { overflow: hidden !important; margin: 0 !important; }';
    document.head.appendChild(style);
  });
})();
"#;

/// The key from a message the initialization script posted, if it is one.
pub fn token_from_message(body: &str) -> Option<String> {
    let msg: serde_json::Value = serde_json::from_str(body).ok()?;
    if msg.get("type")?.as_str()? != "token" {
        return None;
    }
    let token = msg.get("token")?.as_str()?;
    // Shorter strings are not keys (the iframe bridge applied the same floor).
    (token.len() >= 20).then(|| token.to_string())
}

/// Whether a top-level URL may stay in the ad view. Anything else was an ad navigating the
/// whole view away, which would also stop the key renewing.
pub fn stays_in_view(url: &str) -> bool {
    if url == "about:blank" {
        return true;
    }
    url::Url::parse(url)
        .ok()
        .is_some_and(|u| u.scheme() == "https" && u.host_str() == Some(WAGO_HOST))
}

#[cfg(any(target_os = "linux", windows))]
mod native {
    use super::*;
    use std::cell::RefCell;
    use tauri_runtime_wry::wry;

    pub(super) struct AdView {
        webview: wry::WebView,
        // Must outlive the webview.
        _context: wry::WebContext,
    }

    thread_local! {
        // wry webviews are not Send; everything here runs on the main thread.
        static VIEW: RefCell<Option<AdView>> = const { RefCell::new(None) };
        #[cfg(target_os = "linux")]
        static HOLDER: RefCell<Option<gtk::Fixed>> = const { RefCell::new(None) };
    }

    #[cfg(target_os = "linux")]
    pub fn install_overlay(window: &tauri::WebviewWindow) -> Result<(), String> {
        use gtk::prelude::*;

        let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
        let vbox = window.default_vbox().map_err(|e| e.to_string())?;

        // Before the window is first shown, so the page's webview is moved before it has
        // been mapped rather than torn down and rebuilt on screen.
        let overlay = gtk::Overlay::new();
        gtk_window.remove(&vbox);
        overlay.add(&vbox);

        let holder = gtk::Fixed::new();
        holder.set_halign(gtk::Align::Start);
        holder.set_valign(gtk::Align::Start);
        // Hidden until the renderer places it; otherwise show_all on the window would map an
        // empty holder at the top-left corner.
        holder.set_no_show_all(true);
        overlay.add_overlay(&holder);

        gtk_window.add(&overlay);
        overlay.show();
        vbox.show();

        HOLDER.with(|h| *h.borrow_mut() = Some(holder));
        Ok(())
    }

    fn create(app: &AppHandle, bounds: AdBounds) -> Result<AdView, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("ad-view");
        // Its own storage, as Electron's `persist:adpartition`: ad cookies stay out of the
        // app's, and survive restarts so consent and frequency caps do too.
        let mut context = wry::WebContext::new(Some(data_dir));

        let token_app = app.clone();
        let link_app = app.clone();
        let load_app = app.clone();

        let builder = wry::WebViewBuilder::new_with_web_context(&mut context)
            .with_url(AD_URL)
            .with_initialization_script_for_main_only(INIT_SCRIPT, true)
            .with_background_color((0x2b, 0x2c, 0x2e, 0xff))
            .with_ipc_handler(move |req| {
                if let Some(token) = token_from_message(req.body()) {
                    log::info!("[ad] token received");
                    if let Err(e) = token_app.emit(EVT_TOKEN, token) {
                        log::error!("[ad] could not forward the token: {e}");
                    }
                }
            })
            .with_new_window_req_handler(move |url, _features| {
                let _ = link_app.emit(EVT_LINK, url);
                wry::NewWindowResponse::Deny
            })
            .with_on_page_load_handler(move |event, url| {
                if matches!(event, wry::PageLoadEvent::Started) && !stays_in_view(&url) {
                    log::info!("[ad] the ad navigated the view away; restoring it");
                    let _ = load_app.emit(EVT_LINK, url);
                    // Not from inside the load signal that is reporting this navigation.
                    let _ = load_app.run_on_main_thread(|| {
                        VIEW.with(|v| {
                            if let Some(view) = v.borrow().as_ref() {
                                let _ = view.webview.load_url(AD_URL);
                            }
                        });
                    });
                }
            });

        #[cfg(target_os = "linux")]
        let webview = {
            use wry::WebViewBuilderExtUnix;
            let _ = bounds;
            let holder = HOLDER
                .with(|h| h.borrow().clone())
                .ok_or("the ad overlay was not installed")?;
            builder.build_gtk(&holder).map_err(|e| e.to_string())?
        };

        #[cfg(windows)]
        let webview = {
            let window = app.get_webview_window("main").ok_or("no main window")?;
            builder
                .with_bounds(rect(bounds))
                .build_as_child(&window)
                .map_err(|e| e.to_string())?
        };

        log::info!("[ad] view created for {AD_URL}");
        Ok(AdView {
            webview,
            _context: context,
        })
    }

    #[cfg(windows)]
    fn rect(b: AdBounds) -> wry::Rect {
        wry::Rect {
            position: wry::dpi::LogicalPosition::new(b.x, b.y).into(),
            size: wry::dpi::LogicalSize::new(b.width, b.height).into(),
        }
    }

    fn place(view: &AdView, b: AdBounds) -> Result<(), String> {
        let drawable = b.drawable();

        #[cfg(target_os = "linux")]
        {
            use gtk::prelude::*;
            use wry::WebViewExtUnix;
            let (w, h) = (b.width.round() as i32, b.height.round() as i32);
            HOLDER.with(|cell| {
                if let Some(holder) = cell.borrow().as_ref() {
                    holder.set_margin_start(b.x.round() as i32);
                    holder.set_margin_top(b.y.round() as i32);
                    if drawable {
                        holder.set_size_request(w, h);
                        let widget = view.webview.webview();
                        widget.set_size_request(w, h);
                        widget.show();
                        holder.show();
                    } else {
                        holder.hide();
                    }
                }
            });
            view.webview
                .set_bounds(wry::Rect {
                    position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                    size: wry::dpi::LogicalSize::new(b.width.max(1.0), b.height.max(1.0)).into(),
                })
                .map_err(|e| e.to_string())?;
        }

        #[cfg(windows)]
        {
            if drawable {
                view.webview
                    .set_bounds(rect(b))
                    .map_err(|e| e.to_string())?;
            }
            view.webview
                .set_visible(drawable)
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub(super) fn apply(app: &AppHandle, bounds: AdBounds) -> Result<(), String> {
        VIEW.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                // Created on the first report even when hidden: the page has to run for the
                // Wago provider to get its key, dialog or no dialog.
                *slot = Some(create(app, bounds)?);
            }
            place(slot.as_ref().expect("just created"), bounds)
        })
    }

    pub(super) fn reload() {
        VIEW.with(|cell| {
            if let Some(view) = cell.borrow().as_ref() {
                if let Err(e) = view.webview.load_url(AD_URL) {
                    log::error!("[ad] reload failed: {e}");
                }
            }
        });
    }
}

#[cfg(target_os = "linux")]
pub use native::install_overlay;

/// Port of the Electron `wago-ads` controller's bounds channel: the renderer reports the ad
/// slot's rectangle (and whether a dialog is covering it) whenever it changes.
#[tauri::command]
pub fn ad_view_set_bounds(app: AppHandle, bounds: AdBounds) -> Result<(), String> {
    #[cfg(any(target_os = "linux", windows))]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(e) = native::apply(&handle, bounds) {
                log::error!("[ad] could not place the ad view: {e}");
            }
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = (app, bounds);
        Ok(())
    }
}

/// A provider asks for a fresh ad (and key) after an authentication failure.
#[tauri::command]
pub fn ad_view_reload(app: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "linux", windows))]
    {
        app.run_on_main_thread(native::reload)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_token_messages_with_a_real_key_are_accepted() {
        let key = "k".repeat(32);
        assert_eq!(
            token_from_message(&format!(r#"{{"type":"token","token":"{key}"}}"#)),
            Some(key)
        );
        assert_eq!(
            token_from_message(r#"{"type":"token","token":"short"}"#),
            None
        );
        assert_eq!(
            token_from_message(r#"{"type":"other","token":"kkkkkkkkkkkkkkkkkkkkkkkk"}"#),
            None
        );
        assert_eq!(token_from_message("not json"), None);
    }

    #[test]
    fn only_wago_pages_stay_in_the_view() {
        assert!(stays_in_view(AD_URL));
        assert!(stays_in_view("https://addons.wago.io/wowup_ad_nitro?x=1"));
        assert!(stays_in_view("about:blank"));
        assert!(!stays_in_view("https://advertiser.example/landing"));
        assert!(!stays_in_view("http://addons.wago.io/wowup_ad_nitro"));
        assert!(!stays_in_view("https://addons.wago.io.evil.example/"));
    }

    #[test]
    fn bounds_deserialise_from_the_renderer() {
        let b: AdBounds = serde_json::from_value(serde_json::json!({
            "x": 0, "y": 466.5, "width": 300, "height": 250, "visible": true
        }))
        .unwrap();
        assert!(b.drawable());
        assert!(!AdBounds {
            visible: false,
            ..b
        }
        .drawable());
        assert!(!AdBounds { width: 0.0, ..b }.drawable());
    }
}
