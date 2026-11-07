// The app-side steps of My Addons → right-click → "Copy settings from": scanning both WTF
// folders through the file IPC, and backing up the target before anything is written. The
// matching itself is in services/addon-settings-copy.ts, the screen in
// components/addons/CopyAddonSettingsDialog.svelte.

import type { Addon, WowInstallation } from 'wowup-lib-core';
import * as fileService from '$lib/services/files';
import {
	applySettingsCopy,
	scanSettings,
	type SettingsCopyPlan,
	type SettingsInventory,
	type WtfReader
} from '$lib/services/addon-settings-copy';
import { wtf } from '$lib/services/wtf';
import { addonFlavors } from '$lib/state/addon-flavors.svelte';

/** A folder that is not there has nothing in it: an account never used in that flavor. */
const reader: WtfReader = {
	listDirectories: (dir) =>
		fileService.listDirectories(dir).then(
			(d) => d ?? [],
			() => []
		),
	listFiles: (dir, filter) =>
		fileService.listFiles(dir, filter).then(
			(f) => f ?? [],
			() => []
		)
};

/**
 * The addon's folders here and in the source flavor: settings files are named after folders,
 * and an addon can gain or lose one between versions.
 */
export function settingsFolders(addon: Addon, source: WowInstallation): string[] {
	return [
		...(addon.installedFolderList ?? []),
		...(addonFlavors.findIn(addon, source.id)?.installedFolderList ?? [])
	];
}

/** What the addon has saved in each account and character, on both sides. */
export async function scanBoth(
	addon: Addon,
	source: WowInstallation,
	target: WowInstallation
): Promise<{ source: SettingsInventory; target: SettingsInventory }> {
	const folders = settingsFolders(addon, source);
	const [s, t] = await Promise.all([
		scanSettings(reader, folders, wtf.getWtfPath(source)),
		scanSettings(reader, folders, wtf.getWtfPath(target))
	]);
	return { source: s, target: t };
}

/** Which step failed: nothing is written if the backup fails. */
export class CopySettingsError extends Error {
	constructor(
		readonly stage: 'backup' | 'copy',
		readonly cause: unknown
	) {
		super(`${stage} failed: ${String(cause)}`);
	}
}

/** Backs up the target's WTF folder (Interface Settings Backup), then copies. */
export async function backupAndCopy(
	target: WowInstallation,
	plan: SettingsCopyPlan
): Promise<void> {
	try {
		await wtf.createBackup(target);
	} catch (e) {
		throw new CopySettingsError('backup', e);
	}
	try {
		await applySettingsCopy(fileService, plan);
	} catch (e) {
		throw new CopySettingsError('copy', e);
	}
}
