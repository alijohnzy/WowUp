// The CORS escape hatch, asserted at the level that actually breaks.
//
// Both halves fail silently in the same direction: a request that stays inside the webview
// under Tauri is rejected by CORS with no status, which the providers report as a generic
// "an error occurred" while the addon list still renders from the local database.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetchMock = vi.fn();
const globalFetchMock = vi.fn();
let tauriPresent = false;

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => tauriFetchMock(...a) }));
vi.mock('$lib/ipc', () => ({ isTauri: () => tauriPresent }));

import { configureAxiosForTauri, httpFetch, resetAxiosConfigurationForTests } from './http';

beforeEach(() => {
	tauriFetchMock.mockReset().mockResolvedValue(new Response('{}'));
	globalFetchMock.mockReset().mockResolvedValue(new Response('{}'));
	vi.stubGlobal('fetch', globalFetchMock);
	tauriPresent = false;
	resetAxiosConfigurationForTests();
});

describe('httpFetch', () => {
	it('leaves the webview under Tauri, so CORS does not apply', async () => {
		tauriPresent = true;
		await httpFetch('https://api.curseforge.com/v1/mods/1');

		expect(tauriFetchMock).toHaveBeenCalledWith('https://api.curseforge.com/v1/mods/1', undefined);
		expect(globalFetchMock).not.toHaveBeenCalled();
	});

	it('uses the native fetch under Electron, which runs with webSecurity off', async () => {
		await httpFetch('https://api.curseforge.com/v1/mods/1');

		expect(globalFetchMock).toHaveBeenCalled();
		expect(tauriFetchMock).not.toHaveBeenCalled();
	});

	it('forwards init through unchanged', async () => {
		tauriPresent = true;
		const init = { method: 'POST', headers: { 'x-api-key': 'k' } };
		await httpFetch('https://api.curseforge.com/v1/mods', init);

		expect(tauriFetchMock).toHaveBeenCalledWith('https://api.curseforge.com/v1/mods', init);
	});
});

describe('configureAxiosForTauri', () => {
	it('routes curseforge-v2 off XHR and onto httpFetch', async () => {
		// curseforge-v2 calls the default axios instance, and axios in a browser bundle
		// defaults to XMLHttpRequest — which Tauri cannot intercept.
		tauriPresent = true;
		await configureAxiosForTauri();

		const { default: axios } = await import('axios');
		expect(axios.defaults.adapter).toBe('fetch');
		expect((axios.defaults.env as { fetch?: unknown } | undefined)?.fetch).toBe(httpFetch);
	});

	it('leaves axios alone under Electron', async () => {
		const { default: axios } = await import('axios');
		const before = axios.defaults.adapter;

		await configureAxiosForTauri();

		expect(axios.defaults.adapter).toBe(before);
	});
});
