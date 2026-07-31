// The renderer's HTTP seam, for the same reason $lib/ipc exists.
//
// Electron runs the renderer with `webSecurity: false` (app/main.ts:297), so every provider
// call to CurseForge, Wago, GitHub and raider.io is a cross-origin request that simply is
// not checked. Tauri has no such switch: the webview enforces CORS against
// tauri://localhost, and none of those APIs send back permissive CORS headers, so the same
// requests fail — as opaque network errors, with no status to report.
//
// @tauri-apps/plugin-http issues the request from Rust instead, which is not subject to the
// webview's origin checks. Its `fetch` is signature-compatible, so the swap is confined to
// this file.

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from '$lib/ipc';

/**
 * `fetch`, routed through Rust under Tauri and left alone everywhere else.
 *
 * Every network call the renderer makes should go through this rather than global `fetch` —
 * `src/lib/ipc-channels.spec.ts`'s sibling guard (`http-callers.spec.ts`) enforces that.
 */
export function httpFetch(input: URL | Request | string, init?: RequestInit): Promise<Response> {
	return isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init);
}

let axiosConfigured = false;

/**
 * Points axios at {@link httpFetch}.
 *
 * `curseforge-v2` — the CurseForge v2 client, used for ten live calls in
 * curse-addon-provider.ts — calls the default axios instance directly, and axios in a
 * browser bundle defaults to `XMLHttpRequest`. Tauri cannot intercept XHR, so those calls
 * would be the one part of the renderer still bound by CORS. (This is also why
 * `tauri-plugin-cors-fetch` is not the answer: it hooks `fetch` only, and says so.)
 *
 * Rather than a hand-written adapter, this uses axios's own `fetch` adapter and hands it a
 * custom implementation via `config.env.fetch`, which is a supported entry point
 * (`getFetch` reads `config.env` when resolving the adapter). `env` is not in axios's merge
 * map, so it deep-merges from defaults and a caller that passes no `env` — which
 * curseforge-v2 does not — inherits this.
 *
 * Idempotent, and a no-op outside Tauri so the Electron build keeps its existing transport.
 */
export async function configureAxiosForTauri(): Promise<void> {
	if (axiosConfigured || !isTauri()) return;
	axiosConfigured = true;

	// Imported lazily: axios reaches the renderer only as curseforge-v2's dependency, and the
	// Electron build has no reason to pull it into the entry chunk.
	const { default: axios } = await import('axios');
	axios.defaults.adapter = 'fetch';
	axios.defaults.env = { ...axios.defaults.env, fetch: httpFetch };
}

/** Test seam: lets a spec re-run the one-shot configuration. */
export function resetAxiosConfigurationForTests(): void {
	axiosConfigured = false;
}
