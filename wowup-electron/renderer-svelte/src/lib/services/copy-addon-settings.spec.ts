// Backing up before copying settings between flavors: the backup always comes first, and a
// failed backup means nothing is written. Scanning uses the folders of the addon on both sides.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Addon, WowInstallation } from 'wowup-lib-core';

const calls: string[] = [];
const createBackup = vi.fn();
const copy = vi.fn();
const listFiles = vi.fn();

vi.mock('$lib/state/addon-flavors.svelte', () => ({
	addonFlavors: {
		findIn: () => ({ installedFolderList: ['ElvUI', 'ElvUI_Libraries'] })
	}
}));
vi.mock('$lib/services/wtf', () => ({
	wtf: {
		getWtfPath: (i: WowInstallation) => `/${i.id}/WTF`,
		createBackup: (i: WowInstallation) => {
			calls.push(`backup ${i.id}`);
			return createBackup(i);
		}
	}
}));
vi.mock('$lib/services/files', () => ({
	listDirectories: async (dir: string) => (dir.endsWith('/WTF/Account') ? ['ACC1'] : []),
	listFiles: (dir: string, filter: string) => listFiles(dir, filter),
	createDirectory: async () => true,
	copy: (from: string, to: string) => {
		calls.push(`copy ${from} -> ${to}`);
		return copy(from, to);
	}
}));

import { backupAndCopy, CopySettingsError, scanBoth } from './copy-addon-settings';

const SOURCE = { id: 'classic', displayName: 'Classic' } as WowInstallation;
const TARGET = { id: 'retail', displayName: 'Retail' } as WowInstallation;
const PLAN = { files: [{ from: '/classic/x.lua', to: '/retail/x.lua', replaces: true }] };

beforeEach(() => {
	calls.length = 0;
	createBackup.mockReset().mockResolvedValue(undefined);
	copy.mockReset().mockResolvedValue('');
	listFiles.mockReset().mockResolvedValue([]);
});

describe('backupAndCopy', () => {
	it('backs up the target before copying', async () => {
		await backupAndCopy(TARGET, PLAN);
		expect(calls).toEqual(['backup retail', 'copy /classic/x.lua -> /retail/x.lua']);
	});

	it('copies nothing when the backup fails, and says which step failed', async () => {
		createBackup.mockRejectedValue(new Error('disk full'));

		const error = await backupAndCopy(TARGET, PLAN).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(CopySettingsError);
		expect((error as CopySettingsError).stage).toBe('backup');
		expect(calls).toEqual(['backup retail']);
	});

	it('reports a failed copy as such', async () => {
		copy.mockRejectedValue(new Error('read-only'));
		const error = await backupAndCopy(TARGET, PLAN).catch((e: unknown) => e);
		expect((error as CopySettingsError).stage).toBe('copy');
	});
});

describe('scanBoth', () => {
	it('looks for the folders the addon has here and in the source flavor', async () => {
		listFiles.mockImplementation(async (dir: string) =>
			dir.startsWith('/classic') ? ['ElvUI.lua', 'ElvUI_Libraries.lua', 'Other.lua'] : []
		);
		const addon = { name: 'ElvUI', installedFolderList: ['ElvUI', 'ElvUI_Options'] } as Addon;

		const { source, target } = await scanBoth(addon, SOURCE, TARGET);

		expect(source.accounts[0].files).toEqual(['ElvUI.lua', 'ElvUI_Libraries.lua']);
		expect(target.accounts[0].files).toEqual([]);
	});
});
