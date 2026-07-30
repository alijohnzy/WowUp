// Replaces the auto-update half of app.component.ts: initializeAutoUpdate,
// onAutoUpdateInterval, showManyAddonsAutoUpdated, showFewAddonsAutoUpdated,
// checkQuitEnabled and updateBadgeCount (~120 LOC).
//
// This never had anything to do with the app shell — it is a background job that happens to
// raise a desktop notification. Angular kept it in AppComponent because that is where the
// interval handle lived; here it is a module with an explicit start().

import {
	IPC_GET_LAUNCH_ARGS,
	WOWUP_LOGO_FILENAME,
	WOWUP_LOGO_FILENAME_CF
} from '$common/constants';
import { AppConfig } from '$config/environment';
import { invoke, isElectron } from '$lib/ipc';
import { getAssetFilePath } from '$lib/services/files';
import { i18n } from '$lib/i18n.svelte';
import { addonService } from '$lib/state/addon.svelte';
import { electron } from '$lib/state/electron.svelte';
import { session } from '$lib/state/session.svelte';
import { wowup } from '$lib/state/wowup.svelte';
import { wowUpAddon } from '$lib/services/wowup-addon';
import type { Addon } from 'wowup-lib-core';

let interval: number | undefined;

/**
 * `--quit` means "update in the background, then exit" — the scheduled-task mode. The original
 * ran the launch args through minimist purely to read this one boolean.
 */
async function shouldQuitAfterUpdate(): Promise<boolean> {
	if (!isElectron()) return false;

	try {
		const args = await invoke<string[]>(IPC_GET_LAUNCH_ARGS);
		return args.slice(1).some((arg) => arg === '--quit' || arg === '--quit=true');
	} catch (e) {
		console.error('Failed to read launch args', e);
		return false;
	}
}

async function checkQuitEnabled(): Promise<void> {
	if (!(await shouldQuitAfterUpdate())) return;

	console.debug('checkQuitEnabled');
	await electron.quitApplication().catch((e: unknown) => console.error(e));
}

export async function updateBadgeCount(): Promise<void> {
	try {
		const addons = await addonService.getAllAddonsAvailableForUpdate();
		await wowup.updateAppBadgeCount(addons.length);
	} catch (e) {
		console.error('Failed to update badge count', e);
	}
}

async function logoPath(): Promise<string> {
	return await getAssetFilePath(
		AppConfig.curseforge.enabled ? WOWUP_LOGO_FILENAME_CF : WOWUP_LOGO_FILENAME
	);
}

function notify(title: string, body: string, icon: string): void {
	const notification = new Notification(title, { body, icon });

	notification.addEventListener(
		'click',
		() => void electron.focusWindow().catch((e: unknown) => console.error(e)),
		{ once: true }
	);
	notification.addEventListener('close', () => void checkQuitEnabled(), { once: true });
}

/** Windows truncates notification bodies, so a long list collapses to a count. */
async function showAutoUpdated(updated: Addon[]): Promise<void> {
	const names = updated.map((addon) => addon.name);
	const icon = await logoPath();
	const title = i18n.t('APP.AUTO_UPDATE_NOTIFICATION_TITLE', { count: updated.length });

	if (names.join(' ').length > 60) {
		notify(title, i18n.t('APP.AUTO_UPDATE_NOTIFICATION_BODY', { count: updated.length }), icon);
	} else {
		notify(
			title,
			i18n.t('APP.AUTO_UPDATE_FEW_NOTIFICATION_BODY', { addonNames: names.join('\r\n') }),
			icon
		);
	}
}

async function runOnce(): Promise<void> {
	try {
		console.log('onAutoUpdateInterval');
		await addonService.syncAllClients();
		const updatedAddons = await addonService.processAutoUpdates();

		await wowUpAddon.updateForAllClientTypes();
		await updateBadgeCount();

		if (!updatedAddons || updatedAddons.length === 0) {
			await checkQuitEnabled();
			return;
		}

		if (!(await wowup.getEnableSystemNotifications())) {
			await checkQuitEnabled();
			return;
		}

		await showAutoUpdated(
			updatedAddons.filter((addon) => addon.autoUpdateNotificationsEnabled === true)
		);
	} catch (e) {
		console.error('Error during auto update', e);
	} finally {
		session.autoUpdateComplete();
	}
}

export async function startAutoUpdate(): Promise<void> {
	if (interval !== undefined) {
		console.warn('Auto addon update interval already exists');
		return;
	}

	interval = window.setInterval(() => void runOnce(), AppConfig.autoUpdateIntervalMs);
	await runOnce();
}

export function stopAutoUpdate(): void {
	if (interval === undefined) return;
	window.clearInterval(interval);
	interval = undefined;
}
