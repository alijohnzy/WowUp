// Start with system is registered with the OS on every launch, under Tauri as under Electron.
//
// Under Tauri it was only registered when the toggle was flipped, so a preference that arrived
// any other way — imported from WowUp, or set before the rename to WowUpNight, whose entry
// went with the old install — showed as on while nothing started at login.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
const setLoginItemSettings = vi.fn();
const createDirectory = vi.fn();
let devMode = false;

vi.mock('$app/environment', () => ({
	get dev() {
		return devMode;
	}
}));
vi.mock('$lib/services/storage', () => ({
	preferenceStorage: {
		getAsync: (key: string) => Promise.resolve(stored.get(key)),
		setAsync: (key: string, value: unknown) => {
			stored.set(key, value);
			return Promise.resolve();
		}
	}
}));
// What the Tauri shell looks like to the renderer: no Electron preload, a desktop all the same.
vi.mock('$lib/ipc', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/ipc')>()),
	isElectron: () => false,
	isDesktop: () => true,
	isLinux: () => false,
	isMac: () => false,
	isWin: () => true,
	invoke: vi.fn(() => Promise.resolve(undefined))
}));
vi.mock('$lib/services/files', () => ({
	createDirectory: (path: string) => createDirectory(path),
	listEntries: async () => [],
	remove: async () => undefined,
	showDirectory: async () => ''
}));
vi.mock('$lib/state/electron.svelte', () => ({
	electron: { setLoginItemSettings: (s: unknown) => setLoginItemSettings(s) }
}));

import {
	START_MINIMIZED_PREFERENCE_KEY,
	START_WITH_SYSTEM_PREFERENCE_KEY
} from '$common/constants';
import { wowup } from './wowup.svelte';

beforeEach(() => {
	stored.clear();
	devMode = false;
	setLoginItemSettings.mockReset().mockResolvedValue(undefined);
	createDirectory.mockReset();
});

describe('start with system at launch under Tauri', () => {
	it('is registered when the preference is on, though the toggle was never touched', async () => {
		stored.set(START_WITH_SYSTEM_PREFERENCE_KEY, 'true');
		stored.set(START_MINIMIZED_PREFERENCE_KEY, 'true');

		await wowup.init();

		expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
		expect(setLoginItemSettings.mock.calls[0][0]).toMatchObject({ openAtLogin: true });
	});

	it('is removed when the preference is off or was never set', async () => {
		await wowup.init();

		expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
		expect(setLoginItemSettings.mock.calls[0][0]).toMatchObject({ openAtLogin: false });
	});

	it('is left alone in a dev build, which would register the debug binary', async () => {
		devMode = true;
		stored.set(START_WITH_SYSTEM_PREFERENCE_KEY, 'true');

		await wowup.init();

		expect(setLoginItemSettings).not.toHaveBeenCalled();
	});

	it('does not run the Electron-only housekeeping', async () => {
		await wowup.init();

		expect(createDirectory).not.toHaveBeenCalled();
	});
});
