// My Addons → right-click → "Copy settings from" → a flavor: the user-facing steps around
// services/addon-settings-copy.ts. Shows what will be copied with a warning, backs up the
// target's WTF folder with the existing Interface Settings Backup, then copies.

import type { Addon, WowInstallation } from 'wowup-lib-core';
import { i18n, t } from '$lib/i18n.svelte';
import * as fileService from '$lib/services/files';
import {
	applySettingsCopy,
	planSettingsCopy,
	type SettingsCopyPlan,
	type WtfReader
} from '$lib/services/addon-settings-copy';
import { wtf } from '$lib/services/wtf';
import { addonFlavors } from '$lib/state/addon-flavors.svelte';
import { dialogs } from '$lib/state/dialogs.svelte';
import { snackbar } from '$lib/state/snackbar.svelte';
import { escapeHtml } from '$lib/utils/string';

const KEY = 'PAGES.MY_ADDONS.COPY_SETTINGS';

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

function confirmMessage(plan: SettingsCopyPlan, args: Record<string, string>): string {
	const parts = [
		i18n.t(`${KEY}.CONFIRM_MESSAGE`, { ...args, count: plan.files.length }),
		t(`${KEY}.WARNING`),
		i18n.t(`${KEY}.BACKUP_NOTE`, args)
	];
	if (plan.skippedAccounts.length > 0) {
		parts.push(
			i18n.t(`${KEY}.SKIPPED_ACCOUNTS`, {
				...args,
				accounts: escapeHtml(plan.skippedAccounts.join(', ')),
				count: plan.skippedAccounts.length
			})
		);
	}
	return parts.join('\n\n');
}

/**
 * Copies `addon`'s settings from the `source` installation into `target`, the installation it
 * is listed under. Asks first; every outcome is reported to the user. True if copied.
 */
export async function copyAddonSettings(
	addon: Addon,
	source: WowInstallation,
	target: WowInstallation
): Promise<boolean> {
	// Titles are text, messages are HTML: names come from addon providers and from the user.
	const text = { addonName: addon.name, source: source.displayName, target: target.displayName };
	const html = {
		addonName: escapeHtml(addon.name),
		source: escapeHtml(source.displayName),
		target: escapeHtml(target.displayName),
		backupLabel: escapeHtml(t('PAGES.MY_ADDONS.WTF_BACKUP_BUTTON'))
	};
	// The source copy's folders too: an addon can gain or lose a folder between versions.
	const folders = [
		...(addon.installedFolderList ?? []),
		...(addonFlavors.findIn(addon, source.id)?.installedFolderList ?? [])
	];

	let plan: SettingsCopyPlan;
	try {
		plan = await planSettingsCopy(reader, folders, wtf.getWtfPath(source), wtf.getWtfPath(target));
	} catch (e) {
		return fail('READ_FAILED', e, html);
	}

	if (plan.files.length === 0) {
		await dialogs.alert({
			title: t(`${KEY}.NOTHING_TITLE`),
			message: i18n.t(`${KEY}.NOTHING_MESSAGE`, html)
		});
		return false;
	}

	const confirmed = await dialogs.confirm({
		title: i18n.t(`${KEY}.CONFIRM_TITLE`, text),
		message: confirmMessage(plan, html),
		positiveKey: `${KEY}.CONFIRM_BUTTON`,
		negativeKey: `${KEY}.CANCEL_BUTTON`
	});
	if (!confirmed) return false;

	const progress = snackbar.show(`${KEY}.IN_PROGRESS`, { timeout: 0 });
	try {
		await wtf.createBackup(target);
	} catch (e) {
		snackbar.dismiss(progress);
		return fail('BACKUP_FAILED', e, html);
	}
	try {
		await applySettingsCopy(fileService, plan);
	} catch (e) {
		snackbar.dismiss(progress);
		return fail('COPY_FAILED', e, html);
	}

	snackbar.showSuccess(`${KEY}.SUCCESS`, { localeArgs: { ...text, count: plan.files.length } });
	return true;
}

async function fail(
	reason: 'READ_FAILED' | 'BACKUP_FAILED' | 'COPY_FAILED',
	error: unknown,
	args: Record<string, string>
): Promise<false> {
	console.error(`[copy-settings] ${reason}`, error);
	await dialogs.alert({
		title: t(`${KEY}.FAILED_TITLE`),
		message: i18n.t(`${KEY}.${reason}`, { ...args, error: escapeHtml(String(error)) })
	});
	return false;
}
