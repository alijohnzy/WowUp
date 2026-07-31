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
 * An axios adapter that issues the request through {@link httpFetch}.
 *
 * Written out rather than reusing axios's own `fetch` adapter via `config.env.fetch`. That
 * looked like the tidy route — `getFetch()` does read `config.env` — but measured against
 * the running app it never took effect: `axios.defaults.adapter` was `'fetch'` and
 * `defaults.env.fetch` was a function, and still not one CurseForge request reached
 * httpFetch. An explicit adapter has no such ambiguity.
 *
 * This matters because of a specific CurseForge behaviour. `POST /v1/fingerprints` — the
 * call that matches installed folders to addons — sends `content-type: application/json`
 * and `x-api-key`, which forces a CORS preflight, and CurseForge answers
 * `OPTIONS /v1/fingerprints` with **405 and no CORS headers**. Their GET endpoints preflight
 * fine, which is why browsing addons worked while matching failed with a bare
 * "AxiosError: Network Error", surfacing as "An error occurred matching your addon folders
 * with Curse". Electron never saw it because `webSecurity: false` skips the preflight
 * entirely. Going through Rust does too.
 */
async function tauriAxiosAdapter(config: Record<string, unknown>): Promise<unknown> {
	const method = String(config.method ?? 'get').toUpperCase();
	const url = String(config.url ?? '');

	// AxiosHeaders in recent versions; toJSON flattens it to a plain record.
	const rawHeaders = config.headers as { toJSON?: () => Record<string, string> } | undefined;
	const headers = rawHeaders?.toJSON?.() ?? (config.headers as Record<string, string>) ?? {};

	// axios has already run transformRequest, so `data` is a string for a JSON body.
	const body = config.data as BodyInit | undefined;

	const timeout = typeof config.timeout === 'number' && config.timeout > 0 ? config.timeout : 0;
	const controller = new AbortController();
	const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;

	try {
		const res = await httpFetch(url, {
			method,
			headers,
			// A GET/HEAD with a body is a TypeError.
			body: method === 'GET' || method === 'HEAD' ? undefined : body,
			signal: controller.signal
		});

		const text = await res.text();
		const responseType = String(config.responseType ?? 'json');
		let data: unknown = text;
		if (responseType === 'json') {
			try {
				data = text.length ? JSON.parse(text) : null;
			} catch {
				// Leave it as text; axios does the same for unparseable JSON.
				data = text;
			}
		}

		const response = {
			data,
			status: res.status,
			statusText: res.statusText,
			headers: Object.fromEntries(res.headers.entries()),
			config,
			request: null
		};

		// cfv2 reads `e.response.status` on failure, so a non-2xx has to reject with the
		// response attached rather than resolve.
		const validate = config.validateStatus as ((s: number) => boolean) | null | undefined;
		const ok = validate ? validate(res.status) : res.status >= 200 && res.status < 300;
		if (!ok) {
			const error = new Error(`Request failed with status code ${res.status}`) as Error & {
				response?: unknown;
				isAxiosError?: boolean;
			};
			error.response = response;
			error.isAxiosError = true;
			throw error;
		}

		return response;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Points axios at {@link tauriAxiosAdapter}.
 *
 * `curseforge-v2` calls the default axios instance directly, and axios in a browser bundle
 * defaults to `XMLHttpRequest`, which Tauri cannot intercept.
 *
 * Idempotent, and a no-op outside Tauri so the Electron build keeps its existing transport.
 */
export async function configureAxiosForTauri(): Promise<void> {
	if (axiosConfigured || !isTauri()) return;
	axiosConfigured = true;

	// Imported lazily: axios reaches the renderer only as curseforge-v2's dependency, and the
	// Electron build has no reason to pull it into the entry chunk.
	const { default: axios } = await import('axios');
	axios.defaults.adapter = tauriAxiosAdapter as never;
}

/** Test seam: lets a spec re-run the one-shot configuration. */
export function resetAxiosConfigurationForTests(): void {
	axiosConfigured = false;
}
