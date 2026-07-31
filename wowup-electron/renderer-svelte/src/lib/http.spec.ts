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
	it('sends an axios request through httpFetch rather than XHR', async () => {
		// Behavioural on purpose. The previous version asserted `axios.defaults.adapter` and
		// `defaults.env.fetch` and passed while every CurseForge request still went out over
		// XHR — the bundle had two axios instances (CJS for curseforge-v2, ESM for us), so the
		// settings were applied to one and read from the other. Asserting the settings proved
		// nothing; asserting a request lands here proves the adapter is wired.
		tauriPresent = true;
		tauriFetchMock.mockResolvedValue(
			new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
		);

		await configureAxiosForTauri();
		const { default: axios } = await import('axios');
		const res = await axios({
			method: 'post',
			url: 'https://api.curseforge.com/v1/fingerprints',
			data: { fingerprints: [1, 2] }
		});

		expect(tauriFetchMock).toHaveBeenCalled();
		expect(tauriFetchMock.mock.calls.at(-1)?.[0]).toBe(
			'https://api.curseforge.com/v1/fingerprints'
		);
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ ok: true });
	});

	it('rejects a non-2xx with the response attached, as curseforge-v2 expects', async () => {
		// httpSend reads `e.response.status`; resolving instead would hide every API error.
		tauriPresent = true;
		tauriFetchMock.mockResolvedValue(new Response('nope', { status: 403 }));

		await configureAxiosForTauri();
		const { default: axios } = await import('axios');

		await expect(
			axios({ method: 'get', url: 'https://api.curseforge.com/v1/mods/1' })
		).rejects.toMatchObject({ response: { status: 403 } });
	});

	it('leaves axios alone under Electron', async () => {
		const { default: axios } = await import('axios');
		const before = axios.defaults.adapter;

		await configureAxiosForTauri();

		expect(axios.defaults.adapter).toBe(before);
	});
});
