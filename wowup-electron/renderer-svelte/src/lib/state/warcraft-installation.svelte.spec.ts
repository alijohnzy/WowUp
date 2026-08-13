// The same WoW folder must be one installation, however its path is spelled.
//
// A Windows tester had one folder listed as two games — `C:\…\Wow.exe` alongside
// `C:/…/Wow.exe` — because the check for "already have this one" compared the two location
// strings directly. Deleting either did not help: the import runs on every launch, so the
// one that had just been removed came straight back, and its addons came back as a second
// copy with it.
//
// These run in the jsdom project so `window.platform` can be set, which is what decides the
// separator `join` emits.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddonChannelType, WowClientType, type WowInstallation } from 'wowup-lib-core';

let store: WowInstallation[] = [];

vi.mock('$lib/services/storage', () => ({
	preferenceStorage: {
		// Cloned on the way out, as real storage would be: the code under test rewrites
		// `location` in place, and handing back the same objects would hide a missing save.
		getObjectAsync: vi.fn(() => Promise.resolve(structuredClone(store))),
		setAsync: vi.fn((_key: string, value: WowInstallation[]) => {
			store = structuredClone(value);
			return Promise.resolve();
		})
	}
}));

vi.mock('$lib/state/warcraft.svelte', () => ({
	warcraft: {
		// Empty agent path short-circuits the import, leaving only the dedupe under test.
		getBlizzardAgentPath: vi.fn(() => Promise.resolve('')),
		getInstalledProducts: vi.fn(() => Promise.resolve(new Map())),
		getExecutableName: vi.fn(() => Promise.resolve('Wow.exe')),
		getClientTypeForBinary: vi.fn(() => Promise.resolve(WowClientType.Retail)),
		getExecutableExtension: vi.fn(() => Promise.resolve('exe'))
	}
}));

vi.mock('$lib/i18n.svelte', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('$lib/state/electron.svelte', () => ({ electron: { showOpenDialog: vi.fn() } }));

const installation = (location: string, over: Partial<WowInstallation> = {}): WowInstallation => ({
	id: location,
	clientType: WowClientType.Retail,
	defaultAddonChannelType: AddonChannelType.Stable,
	defaultAutoUpdate: false,
	label: '{defaultName}',
	displayName: 'World of Warcraft',
	location,
	selected: false,
	...over
});

/** A fresh singleton per test — `init()` only runs once per module instance. */
async function boot() {
	vi.resetModules();
	const module = await import('./warcraft-installation.svelte');
	await module.warcraftInstallations.init();
	return module.warcraftInstallations;
}

beforeEach(() => {
	store = [];
	window.platform = 'win32';
});

const RETAIL = 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe';

describe('on startup', () => {
	it('collapses one folder listed under two spellings', async () => {
		store = [installation(RETAIL), installation(RETAIL.replace(/\\/g, '/'))];

		const installations = await boot();

		expect(installations.installations).toHaveLength(1);
		expect(installations.installations[0]?.location).toBe(RETAIL);
	});

	it('keeps the first, so the addons already attached to it survive', async () => {
		store = [installation(RETAIL, { id: 'first' }), installation(RETAIL, { id: 'second' })];

		const installations = await boot();

		expect(installations.installations.map((i) => i.id)).toEqual(['first']);
	});

	it('carries the selection over from a dropped duplicate', async () => {
		store = [
			installation(RETAIL, { id: 'first' }),
			installation(RETAIL, { id: 'second', selected: true })
		];

		const installations = await boot();

		expect(installations.installations[0]?.selected).toBe(true);
	});

	// A lone entry in the wrong spelling is what the next import would duplicate, so it is
	// rewritten even though there is nothing to drop.
	it('rewrites a lone foreign spelling to the native one', async () => {
		store = [installation('C:/Program Files (x86)/World of Warcraft/_retail_/Wow.exe')];

		await boot();

		expect(store[0]?.location).toBe(RETAIL);
	});

	it('leaves genuinely different folders alone', async () => {
		store = [
			installation(RETAIL),
			installation('C:\\Program Files (x86)\\World of Warcraft\\_classic_\\Wow.exe', {
				clientType: WowClientType.ClassicEra
			})
		];

		const installations = await boot();

		expect(installations.installations).toHaveLength(2);
	});
});

describe('addInstallation', () => {
	it('refuses a folder already installed under another spelling', async () => {
		store = [installation(RETAIL)];
		const installations = await boot();

		await expect(
			installations.addInstallation(installation(RETAIL.replace(/\\/g, '/'), { id: 'new' }))
		).rejects.toThrow(/already exists/);
	});
});
