// Renderer half of the Tauri ad frame. The Rust half is src-tauri/src/ad.rs, which explains
// why the page is proxied onto its own origin instead of framed directly.
//
// Nothing here talks to a command. The frame is deliberately cross-origin, so `postMessage`
// is the only channel it has — which is the point: ad-network JavaScript gets no access to
// the app's DOM and, since Tauri 2.0.0-beta.20, none to `invoke` either.

import { emit } from '@tauri-apps/api/event';
import { platform } from '$lib/ipc';
import type { AdPageOptions } from 'wowup-lib-core';

/** Must match `AD_SCHEME` in src-tauri/src/ad.rs. */
const AD_SCHEME = 'wowupad';

/** The channel the Wago provider already listens on (wago-addon-provider.ts:199). */
const IPC_WAGO_TOKEN_RECEIVED = 'wago-token-received';

/** Matches `app/wago-handler.ts:29`, which drops anything shorter as malformed. */
const MIN_TOKEN_LEN = 20;

interface AdFrameMessage {
	wowup?: string;
	token?: unknown;
}

/**
 * Where a custom scheme is served from, which differs by platform.
 *
 * Windows uses `http://<scheme>.localhost` because WebView2 has no custom schemes of its own;
 * elsewhere it is a real scheme. Either way the result is a *different origin* to the app's,
 * which is what keeps the frame out of the app's DOM.
 */
function schemeOrigin(): string {
	return platform() === 'win32'
		? `http://${AD_SCHEME}.localhost`
		: `${AD_SCHEME}://localhost`;
}

/**
 * The `src` for the ad iframe, or '' when there is nothing to show.
 *
 * `nonce` only exists to make the URL change: re-assigning an identical `src` does not
 * reload, so a provider asking for a fresh ad would otherwise do nothing.
 */
export function adFrameSrc(options: AdPageOptions, nonce = 0): string {
	// CurseForge returns an empty pageUrl — its ad comes from Overwolf's <owadview>, which
	// cannot run here at all.
	if (!options.pageUrl) return '';

	const params = new URLSearchParams({ url: options.pageUrl });
	if (options.userAgent) params.set('ua', options.userAgent);
	if (nonce) params.set('n', String(nonce));

	return `${schemeOrigin()}/?${params.toString()}`;
}

/**
 * Forward the API key the ad frame hands back, and report that it did.
 *
 * Re-emitted on the same channel the Electron main process uses, so the Wago provider's
 * listener is identical in both shells.
 */
export function onAdFrameToken(onReceived: () => void): () => void {
	const origin = schemeOrigin();

	const listener = (event: MessageEvent) => {
		// The check that matters: without it any frame on the page could inject a token, and
		// the app would start signing Wago requests with whatever it was handed.
		if (event.origin !== origin) return;

		const data = event.data as AdFrameMessage | null;
		if (!data || data.wowup !== 'wago-token') return;

		const token = data.token;
		// Same guard as app/wago-handler.ts:29. Never log the token itself.
		if (typeof token !== 'string' || token.length < MIN_TOKEN_LEN) {
			console.warn(`[ad] malformed token, length ${String(token).length}`);
			return;
		}

		console.log('[ad] token received');
		onReceived();
		void emit(IPC_WAGO_TOKEN_RECEIVED, token).catch((e: unknown) =>
			console.error('could not forward wago token', e)
		);
	};

	window.addEventListener('message', listener);
	return () => window.removeEventListener('message', listener);
}
