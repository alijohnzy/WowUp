// The steps around copying an addon's settings between flavors: nothing is backed up or
// written until the user confirms, the backup comes before any copy, a failed backup stops
// the copy, and names from providers or the user are escaped in the HTML dialog message.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Addon, WowInstallation } from 'wowup-lib-core';

const calls: string[] = [];
const alert = vi.fn();
const confirm = vi.fn();
const createBackup = vi.fn();
let sourceFiles: Record<string, string[]> = {};

vi.mock('$lib/i18n.svelte', () => ({
	t: (key: string) => key,
	i18n: { t: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args)}` }
}));
vi.mock('$lib/state/dialogs.svelte', () => ({
	dialogs: {
		alert: (d: unknown) => {
			calls.push('alert');
			return alert(d);
		},
		confirm: (d: unknown) => {
			calls.push('confirm');
			return confirm(d);
		}
	}
}));
vi.mock('$lib/state/snackbar.svelte', () => ({
	snackbar: {
		show: () => 'progress',
		showSuccess: () => calls.push('success'),
		dismiss: () => {}
	}
}));
vi.mock('$lib/state/addon-flavors.svelte', () => ({
	addonFlavors: { findIn: () => undefined }
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
	listDirectories: async (dir: string) => {
		if (dir.endsWith('/WTF/Account')) return ['ACC1'];
		return [];
	},
	listFiles: async (dir: string) => sourceFiles[dir] ?? [],
	createDirectory: async () => true,
	copy: async (from: string, to: string) => calls.push(`copy ${from} -> ${to}`)
}));

import { copyAddonSettings } from './copy-addon-settings';

const SOURCE = { id: 'classic', displayName: 'Classic <Era>' } as WowInstallation;
const TARGET = { id: 'retail', displayName: 'Retail' } as WowInstallation;
const ADDON = { name: 'Elv"UI', installedFolderList: ['ElvUI'] } as Addon;

beforeEach(() => {
	calls.length = 0;
	alert.mockReset().mockResolvedValue(true);
	confirm.mockReset();
	createBackup.mockReset().mockResolvedValue(undefined);
	sourceFiles = { '/classic/WTF/Account/ACC1/SavedVariables': ['ElvUI.lua'] };
});

describe('copyAddonSettings', () => {
	it('backs up the target, then copies, once the user confirms', async () => {
		confirm.mockResolvedValue(true);

		expect(await copyAddonSettings(ADDON, SOURCE, TARGET)).toBe(true);
		expect(calls).toEqual([
			'confirm',
			'backup retail',
			'copy /classic/WTF/Account/ACC1/SavedVariables/ElvUI.lua -> /retail/WTF/Account/ACC1/SavedVariables/ElvUI.lua',
			'success'
		]);
	});

	it('changes nothing when the user cancels', async () => {
		confirm.mockResolvedValue(false);

		expect(await copyAddonSettings(ADDON, SOURCE, TARGET)).toBe(false);
		expect(calls).toEqual(['confirm']);
	});

	it('says so, and asks nothing, when the source has no settings for the addon', async () => {
		sourceFiles = {};

		expect(await copyAddonSettings(ADDON, SOURCE, TARGET)).toBe(false);
		expect(calls).toEqual(['alert']);
	});

	it('copies nothing when the backup fails', async () => {
		confirm.mockResolvedValue(true);
		createBackup.mockRejectedValue(new Error('disk full'));

		expect(await copyAddonSettings(ADDON, SOURCE, TARGET)).toBe(false);
		expect(calls).toEqual(['confirm', 'backup retail', 'alert']);
		expect(alert.mock.calls[0][0].message).toContain('BACKUP_FAILED');
	});

	it('escapes names in the HTML message but not in the plain-text title', async () => {
		confirm.mockResolvedValue(false);

		await copyAddonSettings(ADDON, SOURCE, TARGET);

		const { title, message } = confirm.mock.calls[0][0];
		expect(title).toContain('Classic <Era>');
		expect(message).toContain('Classic &lt;Era&gt;');
		expect(message).toContain('Elv&quot;UI');
		expect(message).not.toContain('<Era>');
	});
});
