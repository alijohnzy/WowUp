// The WowUp companion: after writing wowup_data_addon for an installation, its row in My Addons
// is added if missing and refreshed from disk, without waiting for a rescan.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Addon, AddonFolder, Toc, WowInstallation } from 'wowup-lib-core';

const ADDONS = '/wow/_forever_/Interface/AddOns';
const DATA = `${ADDONS}/wowup_data_addon`;

let installed: Addon[] = [];
let onDisk: Record<string, AddonFolder> = {};
const saveAddon = vi.fn();
const getAddonFolder = vi.fn();

vi.mock('$lib/state/addon.svelte', () => ({
	addonService: {
		getAllAddons: async () => installed,
		saveAddon: (addon: Addon) => saveAddon(addon),
		addonRemoved: { subscribe: () => {} }
	},
	onAddonInstalled: () => {}
}));
vi.mock('$lib/state/warcraft.svelte', () => ({
	warcraft: {
		getAddonFolderPath: () => ADDONS,
		getAddonFolder: (path: string, dir: string) => getAddonFolder(path, dir)
	}
}));
vi.mock('$lib/state/warcraft-installation.svelte', () => ({
	warcraftInstallations: { getWowInstallation: () => undefined }
}));
vi.mock('$lib/services/files', () => ({
	pathExists: async (path: string) => path === DATA && DATA in onDisk,
	createDirectory: async () => true,
	getAssetFilePath: async (name: string) => `/app/assets/${name}`,
	readFile: async () => 'generated',
	writeFile: async () => undefined,
	copy: async () => '',
	getLatestDirUpdateTime: async () => Date.UTC(2026, 10, 8)
}));

import { wowUpAddon } from './wowup-addon';

const FOREVER = { id: 'forever', displayName: 'Forever', clientType: 10 } as WowInstallation;

const companionToc = (version: string, extra: Partial<Toc> = {}): Toc =>
	({
		fileName: 'wowup_data_addon.toc',
		interface: ['16001'],
		title: 'Addon Update Notifications (WowUp Data)',
		author: 'WowUp',
		version,
		website: 'https://wowup.io',
		addonProvider: 'wowup-app',
		...extra
	}) as Toc;

const dataFolder = (toc: Toc): AddonFolder =>
	({ name: 'wowup_data_addon', path: DATA, status: 'Pending', tocs: [toc] }) as AddonFolder;

const notificationsAddon = {
	id: 'wowup',
	name: 'Addon Update Notifications',
	installationId: 'forever',
	installedFolderList: ['WowUp'],
	installedFolders: 'WowUp',
	installedVersion: '1.0.30',
	gameVersion: ['1.60.1'],
	providerName: 'WowUpHub'
} as Addon;

beforeEach(() => {
	installed = [];
	onDisk = {};
	saveAddon.mockReset().mockResolvedValue(undefined);
	getAddonFolder
		.mockReset()
		.mockImplementation(async (path: string, dir: string) => onDisk[`${path}/${dir}`]);
});

describe('companion row', () => {
	it('is added when the data addon is on disk but not listed yet', async () => {
		installed = [notificationsAddon];
		onDisk = { [DATA]: dataFolder(companionToc('1.0.30')) };

		await wowUpAddon.updateForInstallation(FOREVER);

		expect(saveAddon).toHaveBeenCalledTimes(1);
		expect(saveAddon.mock.calls[0][0]).toMatchObject({
			providerName: 'WowUpCompanion',
			installationId: 'forever',
			installedFolderList: ['wowup_data_addon'],
			installedVersion: '1.0.30',
			isIgnored: true
		});
	});

	it('keeps its id and takes the version on disk when already listed', async () => {
		const listed = {
			id: 'keep-me',
			installationId: 'forever',
			installedFolderList: ['wowup_data_addon'],
			installedVersion: '1.0.29',
			providerName: 'WowUpCompanion'
		} as Addon;
		installed = [notificationsAddon, listed];
		onDisk = { [DATA]: dataFolder(companionToc('1.0.30')) };

		await wowUpAddon.updateForInstallation(FOREVER);

		expect(saveAddon).toHaveBeenCalledTimes(1);
		expect(saveAddon.mock.calls[0][0]).toMatchObject({ id: 'keep-me', installedVersion: '1.0.30' });
	});

	it('is not added for a folder of that name that WowUp did not write', async () => {
		installed = [{ ...notificationsAddon, installedFolderList: ['Other'] }];
		onDisk = { [DATA]: dataFolder(companionToc('1.0.0', { website: 'https://example.com' })) };

		await wowUpAddon.updateForInstallation(FOREVER);

		expect(saveAddon).not.toHaveBeenCalled();
	});

	it('is not looked for when the data addon is not on disk', async () => {
		installed = [{ ...notificationsAddon, installedFolderList: ['Other'] }];

		await wowUpAddon.updateForInstallation(FOREVER);

		expect(getAddonFolder).not.toHaveBeenCalled();
		expect(saveAddon).not.toHaveBeenCalled();
	});
});
