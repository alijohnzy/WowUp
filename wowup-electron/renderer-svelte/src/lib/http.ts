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
export async function httpFetch(
	input: URL | Request | string,
	init?: RequestInit
): Promise<Response> {
	if (!isTauri()) return globalThis.fetch(input, init);

	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

	let res: Response;
	try {
		res = await tauriFetch(input, init);
	} catch (e) {
		// Tauri rejects a command with a plain string, not an Error, so these arrive with no
		// stack and no URL — "The resource id 545763241 is invalid." on its own is untraceable.
		throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${describe(e)}`, { cause: e });
	}

	// The body is read through a *second* command against a resource handle, so it can fail
	// long after the request succeeded — and that rejection carries no URL either. Wrapping
	// the readers here covers every caller, rather than each provider annotating its own.
	return annotateBodyReads(res, url);
}

/** Adds the request URL to any failure from `json()` / `text()` / `arrayBuffer()`. */
function annotateBodyReads(res: Response, url: string): Response {
	const wrap =
		<A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			try {
				return await fn.apply(res, args);
			} catch (e) {
				const detail = e instanceof Error ? e.message : String(e);
				throw new Error(`Reading ${name} body of ${url} failed: ${detail}`, { cause: e });
			}
		};

	// Defined on the instance so the originals stay reachable via the prototype.
	return Object.defineProperties(res, {
		json: { value: wrap('json', res.json), configurable: true },
		text: { value: wrap('text', res.text), configurable: true },
		arrayBuffer: { value: wrap('arrayBuffer', res.arrayBuffer), configurable: true }
	});
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
