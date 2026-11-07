// The "Copy settings from" matching screen: what it preselects, how choices change what gets
// copied, and that copying hands exactly the chosen files to the backup-then-copy step.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Addon, WowInstallation } from 'wowup-lib-core';
import type { SettingsCopyPlan, SettingsInventory } from '$lib/services/addon-settings-copy';

const backupAndCopy = vi.fn<(target: WowInstallation, plan: SettingsCopyPlan) => Promise<void>>();
let inventories: { source: SettingsInventory; target: SettingsInventory };

vi.mock('$lib/services/copy-addon-settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/copy-addon-settings')>()),
	scanBoth: () => Promise.resolve(inventories),
	backupAndCopy: (t: WowInstallation, p: SettingsCopyPlan) => backupAndCopy(t, p)
}));
vi.mock('$lib/state/snackbar.svelte', () => ({ snackbar: { showSuccess: vi.fn() } }));
vi.mock('$lib/i18n.svelte', () => ({
	t: (key: string) => key.replace('PAGES.MY_ADDONS.COPY_SETTINGS.', ''),
	i18n: {
		t: (key: string, args?: Record<string, unknown>) =>
			`${key.replace('PAGES.MY_ADDONS.COPY_SETTINGS.', '')}${args && 'count' in args ? `:${args.count}` : ''}`
	}
}));

import CopyAddonSettingsDialog from './CopyAddonSettingsDialog.svelte';
import { CopySettingsError } from '$lib/services/copy-addon-settings';

const scope = (key: string, files: string[], dir = `/${key}`) => {
	const [account, realm, character] = key.split('/');
	return { key, account, realm, character, dir, files };
};

const SOURCE = { id: 'classic', displayName: 'Classic' } as WowInstallation;
const TARGET = { id: 'retail', displayName: 'Retail' } as WowInstallation;

let dialog: ReturnType<typeof mount> | undefined;
let onclose: ReturnType<typeof vi.fn<(copied: boolean) => void>>;

async function render(): Promise<HTMLElement> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	onclose = vi.fn<(copied: boolean) => void>();
	dialog = mount(CopyAddonSettingsDialog, {
		target,
		props: { addon: { name: 'ElvUI' } as Addon, source: SOURCE, target: TARGET, onclose }
	});
	await tick();
	await tick();
	flushSync();
	return target;
}

const rows = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLSelectElement>('.match-grid select')].map((s) => s.value);

const summary = (root: HTMLElement) => root.querySelector('.summary strong')?.textContent;

const copyButton = (root: HTMLElement) =>
	root.querySelector<HTMLButtonElement>('.dialog-buttons .wu-btn-primary')!;

beforeEach(() => {
	backupAndCopy.mockReset().mockResolvedValue(undefined);
	inventories = {
		source: {
			accounts: [scope('ACC1', ['ElvUI.lua'])],
			characters: [scope('ACC1/Faerlina/Bob', ['ElvUI.lua']), scope('ACC1/Faerlina/Ann', [])]
		},
		target: {
			accounts: [scope('ACC1', ['ElvUI.lua'])],
			characters: [
				scope('ACC1/Area 52/Zed', ['ElvUI.lua']),
				scope('ACC1/Faerlina/Bob', []),
				scope('ACC1/Stormrage/Kim', [])
			]
		}
	};
});

afterEach(() => {
	if (dialog) unmount(dialog);
	dialog = undefined;
	document.body.innerHTML = '';
});

describe('CopyAddonSettingsDialog', () => {
	it('preselects the matching account and character, and offers only sources with settings', async () => {
		const root = await render();

		// account ACC1 ← ACC1; Zed keeps his own; Bob ← Bob; Kim keeps hers.
		expect(rows(root)).toEqual(['ACC1', '', 'ACC1/Faerlina/Bob', '']);
		expect(summary(root)).toBe('SUMMARY:2');

		const characterOptions = [
			...root.querySelectorAll('.match-grid.characters select')[0].querySelectorAll('option')
		].map((o) => o.value);
		expect(characterOptions).toEqual(['', 'ACC1/Faerlina/Bob']); // Ann has nothing to copy
	});

	it('copies one source character to every listed character with "Set all listed to"', async () => {
		const root = await render();
		const setAll = root.querySelector<HTMLSelectElement>('.tools select')!;

		setAll.value = 'ACC1/Faerlina/Bob';
		setAll.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		expect(rows(root)).toEqual([
			'ACC1',
			'ACC1/Faerlina/Bob',
			'ACC1/Faerlina/Bob',
			'ACC1/Faerlina/Bob'
		]);
		expect(summary(root)).toBe('SUMMARY:4');
	});

	it('limits "Set all listed to" to the characters the filter shows', async () => {
		const root = await render();
		const input = root.querySelector<HTMLInputElement>('.tools input')!;
		input.value = 'storm';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		const setAll = root.querySelector<HTMLSelectElement>('.tools select')!;
		setAll.value = 'ACC1/Faerlina/Bob';
		setAll.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		// Kim (Stormrage) changed; Zed and Bob kept what they had.
		expect(rows(root)).toEqual(['ACC1', '', 'ACC1/Faerlina/Bob', 'ACC1/Faerlina/Bob']);
	});

	it('copies exactly the chosen files, then closes', async () => {
		const root = await render();
		const account = root.querySelector<HTMLSelectElement>('.match-grid select')!;
		account.value = '';
		account.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		copyButton(root).click();
		await tick();
		await tick();

		expect(backupAndCopy).toHaveBeenCalledOnce();
		const [target, plan] = backupAndCopy.mock.calls[0];
		expect(target).toBe(TARGET);
		expect(plan.files).toEqual([
			{
				from: '/ACC1/Faerlina/Bob/SavedVariables/ElvUI.lua',
				to: '/ACC1/Faerlina/Bob/SavedVariables/ElvUI.lua',
				replaces: false
			}
		]);
		expect(onclose).toHaveBeenCalledWith(true);
	});

	it('cannot copy with nothing selected', async () => {
		inventories.target.accounts = [scope('OTHER', []), scope('SECOND', [])];
		inventories.target.characters = [scope('OTHER/Stormrage/Kim', [])];
		const root = await render();

		expect(summary(root)).toBe('SUMMARY:0');
		expect(copyButton(root).disabled).toBe(true);
	});

	it('stays open and explains when the backup fails', async () => {
		backupAndCopy.mockRejectedValue(new CopySettingsError('backup', new Error('disk full')));
		const root = await render();

		copyButton(root).click();
		await tick();
		await tick();
		flushSync();

		expect(root.querySelector('.message.error')?.textContent).toBe('BACKUP_FAILED');
		expect(onclose).not.toHaveBeenCalled();
		expect(copyButton(root).disabled).toBe(false);
	});

	it('says so when the source has nothing to copy', async () => {
		inventories.source = { accounts: [scope('ACC1', [])], characters: [] };
		const root = await render();

		expect(root.querySelector('.dialog-content')?.textContent).toContain('NOTHING_FOUND');
		expect(root.querySelector('.match-grid')).toBeNull();
	});
});
