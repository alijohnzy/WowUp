//! The ad frame — Tauri's answer to Electron's `<webview>` in the nav rail.
//!
//! Replaces the `buildWago` half of `AdWebView.svelte` plus `app/wago-handler.ts`. The other
//! half, `<owadview>`, is a custom element supplied by `@overwolf/ow-electron` and has no
//! equivalent here; see `migration/tauri-scope.md` §3.4.
//!
//! This module is only the proxy. The frame itself is an ordinary `<iframe>` in the renderer.
//!
//! # Why an iframe, having tried the alternatives
//!
//! Electron's `<webview>` is a real element in the page's layer tree, so it clips, scrolls and
//! z-orders with the document. Tauri has nothing equivalent, and both native options are
//! *widgets composited above the page* — they cover dialogs and anything else the app draws
//! over that corner. That is not a bug to be tuned out; it is what a native overlay is.
//!
//!   - `Window::add_child` also does not position at all on Linux. `tauri-runtime-wry` builds
//!     child webviews into the window's `default_vbox()`, and wry only honours absolute bounds
//!     for a `gtk::Fixed`; a `gtk::Box` falls through to `pack_start(expand, fill)`, so the ad
//!     and the UI split the window between them. Upstream issue tauri-apps/tauri#10420 is
//!     still open, with a forked `tao`/`wry` as the only fix.
//!   - A borderless child window positions correctly, but is still an overlay: it painted over
//!     the addon details dialog, and showed up as a second entry in alt-tab.
//!
//! An iframe has none of those problems because it is part of the document.
//!
//! # Why the proxy exists
//!
//! `https://addons.wago.io/wowup_ad` answers `X-Frame-Options: SAMEORIGIN`, so it cannot be
//! framed directly. This scheme handler fetches it and re-serves it under our own origin,
//! without that header, with a `<base>` pointing back at Wago so its scripts and the ad still
//! load from where they always did.
//!
//! # Why that is not a hole
//!
//! The document is served on the `wowupad:` scheme, a *different origin* to the app's
//! `tauri://localhost`. So third-party ad JavaScript gets neither the app's DOM (same-origin
//! policy) nor its commands: Tauri has blocked `invoke` from iframes since 2.0.0-beta.20
//! (GHSA-57fm-592m-34r7), and the only channel left open is `postMessage`, which the renderer
//! accepts only from this origin. That is a smaller surface than the capability with
//! `remote.urls` a webview would have needed, which grants an origin *every* app command.

use tauri::http::{Request, Response};

/// The scheme the ad document is re-served under. Must not be the app's own.
pub const AD_SCHEME: &str = "wowupad";

/// Only these may be proxied. The URL arrives from the renderer (the provider owns it), and
/// without this the handler would fetch anything the page could talk it into.
const ALLOWED_HOSTS: &[&str] = &["addons.wago.io"];

/// Used when the caller sends none. "the ad requires a normal looking user agent" — the
/// comment on WAGO_AD_USER_AGENT in wago-addon-provider.ts. WebKitGTK's own is Safari-like and
/// the slot comes back empty.
const DEFAULT_AD_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";

/// Port of `assets/preload/wago.js`, injected into the proxied document.
///
/// `provideApiKey` is the whole contract the page codes against. It reaches the app by
/// `postMessage` rather than IPC — see the module docs on why the frame has no commands.
///
/// The preload's console forwarding is dropped: the frame's console goes nowhere useful and
/// the page is chatty. Its reload-on-no-key timer is kept, because the page answering 500 is
/// the normal way this fails and the frame would otherwise sit empty forever.
const SHIM: &str = r#"<script>
(function () {
  var keyExpectedTimeout;

  Object.defineProperty(window, 'wago', {
    value: Object.freeze({
      provideApiKey: function (key) {
        window.clearTimeout(keyExpectedTimeout);
        keyExpectedTimeout = undefined;
        if (typeof key === 'string' && key.length) {
          parent.postMessage({ wowup: 'wago-token', token: key }, '*');
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

})();
</script>"#;

/// Rewrite the fetched document so it still works from another origin.
///
/// The `<base>` is what keeps the ad alive: the page's script srcs are protocol-relative
/// (`//cdn.intergient.com/...`), which resolve against the *base* URL, so without it they
/// would resolve to `wowupad://cdn.intergient.com/...` and nothing would load.
fn rewrite(html: &str, base: &url::Url) -> String {
    let injected = format!(r#"<base href="{base}">{SHIM}"#);

    // Case-insensitive, because the tag is not ours to rely on the spelling of.
    let lower = html.to_lowercase();
    match lower.find("<head>") {
        Some(i) => {
            let at = i + "<head>".len();
            format!("{}{injected}{}", &html[..at], &html[at..])
        }
        // No <head>: prepending still parses, and is better than dropping the ad entirely.
        None => format!("{injected}{html}"),
    }
}

/// Serve the ad document from our own origin.
///
/// The request URL carries the page to fetch, e.g.
/// `wowupad://localhost/?url=https%3A%2F%2Faddons.wago.io%2Fwowup_ad`, so the provider stays
/// the one source of the ad URL — the renderer passes on what `getAdPageParams()` returned.
pub async fn serve(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match proxy(&request).await {
        Ok(body) => Response::builder()
            .status(200)
            .header("Content-Type", "text/html; charset=utf-8")
            // Deliberately no X-Frame-Options: re-serving without it is the entire point.
            .body(body.into_bytes())
            .unwrap(),
        Err(e) => {
            log::error!("[ad] {e}");
            Response::builder()
                .status(502)
                .header("Content-Type", "text/html; charset=utf-8")
                // Empty rather than an error page: a failed ad should look like no ad, not
                // like the app is broken.
                .body(Vec::new())
                .unwrap()
        }
    }
}

async fn proxy(request: &Request<Vec<u8>>) -> Result<String, String> {
    let (target, user_agent) = parse_request(request.uri().to_string().as_str())?;

    let response = reqwest::Client::new()
        .get(target.clone())
        .header(
            "User-Agent",
            user_agent.as_deref().unwrap_or(DEFAULT_AD_USER_AGENT),
        )
        // The provider sends this too; the ad is served on the strength of it.
        .header("Referer", "https://wago.io")
        .send()
        .await
        .map_err(|e| format!("{target}: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("{target}: HTTP {}", status.as_u16()));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("{target}: {e}"))?;

    log::info!("[ad] served {target} ({} bytes)", html.len());
    Ok(rewrite(&html, &target))
}

/// Pull the target URL and user agent out of the scheme request, refusing anything not on the
/// allow-list.
fn parse_request(uri: &str) -> Result<(url::Url, Option<String>), String> {
    let parsed = uri
        .parse::<url::Url>()
        .map_err(|e| format!("bad ad request {uri}: {e}"))?;

    let mut target = None;
    let mut user_agent = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "url" => target = Some(value.into_owned()),
            "ua" => user_agent = Some(value.into_owned()),
            _ => {}
        }
    }

    let target = target.ok_or_else(|| format!("no url in ad request {uri}"))?;
    let target = target
        .parse::<url::Url>()
        .map_err(|e| format!("bad ad url {target}: {e}"))?;

    if target.scheme() != "https" {
        return Err(format!("refusing non-https ad url {target}"));
    }
    if !ALLOWED_HOSTS.contains(&target.host_str().unwrap_or_default()) {
        return Err(format!("refusing ad url outside the allowlist: {target}"));
    }

    Ok((target, user_agent))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(uri: &str) -> Result<(url::Url, Option<String>), String> {
        parse_request(uri)
    }

    /// The URL comes from the renderer, so the handler must not be a general-purpose fetcher
    /// for anything the ad page can talk it into requesting from the app's network position.
    #[test]
    fn only_allowlisted_hosts_are_proxied() {
        assert!(req("wowupad://localhost/?url=https%3A%2F%2Faddons.wago.io%2Fwowup_ad").is_ok());

        for bad in [
            "wowupad://localhost/?url=https%3A%2F%2Fevil.example%2Fx",
            // A lookalike host must not pass on a prefix or suffix match.
            "wowupad://localhost/?url=https%3A%2F%2Faddons.wago.io.evil.example%2Fx",
            "wowupad://localhost/?url=https%3A%2F%2Fnot-addons.wago.io%2Fx",
        ] {
            assert!(req(bad).is_err(), "{bad} must be refused");
        }
    }

    /// Plain http would let the page be rewritten in transit, and file:// would turn the
    /// handler into an arbitrary file reader.
    #[test]
    fn only_https_is_proxied() {
        assert!(req("wowupad://localhost/?url=http%3A%2F%2Faddons.wago.io%2Fx").is_err());
        assert!(req("wowupad://localhost/?url=file%3A%2F%2F%2Fetc%2Fpasswd").is_err());
    }

    #[test]
    fn a_request_without_a_url_is_refused() {
        assert!(req("wowupad://localhost/").is_err());
    }

    #[test]
    fn the_user_agent_is_carried_through() {
        let (_, ua) =
            req("wowupad://localhost/?url=https%3A%2F%2Faddons.wago.io%2Fa&ua=Custom%2F1").unwrap();
        assert_eq!(ua.as_deref(), Some("Custom/1"));
    }

    /// Without a `<base>` the page's protocol-relative script srcs resolve against `wowupad:`
    /// and the ad never loads — this is the line that keeps the frame from being blank.
    #[test]
    fn rewriting_adds_a_base_and_the_shim() {
        let base: url::Url = "https://addons.wago.io/wowup_ad".parse().unwrap();
        let out = rewrite(
            "<html><head><title>x</title></head><body>b</body></html>",
            &base,
        );

        assert!(out.contains(r#"<base href="https://addons.wago.io/wowup_ad">"#));
        assert!(out.contains("provideApiKey"));
        // Injected inside <head>, before the page's own scripts run.
        assert!(out.find("<base").unwrap() < out.find("<title>").unwrap());
        assert!(out.contains("<body>b</body>"));
    }

    #[test]
    fn rewriting_survives_a_document_without_a_head() {
        let base: url::Url = "https://addons.wago.io/x".parse().unwrap();
        let out = rewrite("<body>only</body>", &base);
        assert!(out.contains("<base href="));
        assert!(out.contains("only"));
    }

    /// The token must not travel over IPC — the frame has no commands by design.
    #[test]
    fn the_shim_uses_postmessage_and_not_ipc() {
        assert!(SHIM.contains("parent.postMessage"));
        assert!(!SHIM.contains("__TAURI"));
        assert!(!SHIM.contains("invoke("));
    }
}
