// Replaces app.component.ts's createAppMenu() (81 LOC) and createSystemTray() (21 LOC).
//
// Both exist only because the native menu bar and the tray menu are built in the main
// process but their labels are translated in the renderer — the renderer resolves the keys
// and ships a flat config object over IPC. That is the whole job, so it is a function
// rather than part of the app shell.

import {
	IPC_CREATE_APP_MENU_CHANNEL,
	IPC_CREATE_TRAY_MENU_CHANNEL,
	IPC_SET_TRAY_UPDATE_COUNT
} from '$common/constants';
import type { MenuConfig, SystemTrayConfig } from '$common/wowup/models';
import { invoke, isDesktop, isElectron, isTauri } from '$lib/ipc';
import { addonService } from '$lib/state/addon.svelte';
import { session } from '$lib/state/session.svelte';
import { t, i18n } from '$lib/i18n.svelte';

export async function createAppMenu(): Promise<void> {
	// create-app-menu has no Tauri command yet (Group I); Tauri also has no menu bar on a
	// decorationless window, so there is nothing to show even once it lands.
	if (!isElectron()) return;

	const config: MenuConfig = {
		quitLabel: t('APP.APP_MENU.QUIT'),

		editLabel: t('APP.APP_MENU.EDIT.LABEL'),
		copyLabel: t('APP.APP_MENU.EDIT.COPY'),
		cutLabel: t('APP.APP_MENU.EDIT.CUT'),
		pasteLabel: t('APP.APP_MENU.EDIT.PASTE'),
		redoLabel: t('APP.APP_MENU.EDIT.REDO'),
		selectAllLabel: t('APP.APP_MENU.EDIT.SELECT_ALL'),
		undoLabel: t('APP.APP_MENU.EDIT.UNDO'),

		viewLabel: t('APP.APP_MENU.VIEW.LABEL'),
		forceReloadLabel: t('APP.APP_MENU.VIEW.FORCE_RELOAD'),
		reloadLabel: t('APP.APP_MENU.VIEW.RELOAD'),
		toggleDevToolsLabel: t('APP.APP_MENU.VIEW.TOGGLE_DEV_TOOLS'),
		toggleFullScreenLabel: t('APP.APP_MENU.VIEW.TOGGLE_FULL_SCREEN'),
		zoomInLabel: t('APP.APP_MENU.VIEW.ZOOM_IN'),
		zoomOutLabel: t('APP.APP_MENU.VIEW.ZOOM_OUT'),
		zoomResetLabel: t('APP.APP_MENU.VIEW.ZOOM_RESET'),

		windowLabel: t('APP.APP_MENU.WINDOW.LABEL'),
		windowCloseLabel: t('APP.APP_MENU.WINDOW.CLOSE')
	};

	try {
		await invoke(IPC_CREATE_APP_MENU_CHANNEL, config);
	} catch (e) {
		console.error('Failed to create app menu', e);
	}
}

export async function createSystemTray(): Promise<void> {
	if (!isDesktop()) return;

	// The original requested only QUIT_ACTION and SHOW_ACTION from the translate service, so
	// checkUpdateLabel arrived undefined and the main process fell back to its English
	// default. The key exists and is translated everywhere, so it is resolved here too.
	const config: SystemTrayConfig = {
		quitLabel: t('APP.SYSTEM_TRAY.QUIT_ACTION'),
		checkUpdateLabel: t('APP.SYSTEM_TRAY.CHECK_UPDATE'),
		showLabel: t('APP.SYSTEM_TRAY.SHOW_ACTION'),
		updateAllLabel: updateAllLabel(0)
	};

	try {
		await invoke(IPC_CREATE_TRAY_MENU_CHANNEL, config);
		// The item is built disabled and unnumbered; this is what fills it in.
		await syncTrayUpdateCount();
	} catch (e) {
		console.error('Failed to create tray', e);
	}
}

/** "Update All" while there is nothing to do, "Update All (4)" when there is. */
function updateAllLabel(count: number): string {
	const label = t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON');
	return count > 0 ? `${label} (${count})` : label;
}

/** What the badge is saying, which decides its colour. Mirrors BadgeState in tray.rs. */
export type TrayBadgeState = 'pending' | 'running' | 'done';

/** Names listed under the tray's Update All. Long lists make the menu unusable. */
const TRAY_MAX_ADDONS = 10;

/**
 * Show the number of pending updates on the tray icon and in its menu.
 *
 * Counted for the *selected* installation, not across all of them, because the tray item
 * runs the same routine as the Update All button — which only touches the selected client.
 * A total would promise more than clicking delivers.
 *
 * Electron's tray has no such item, so this is a no-op there rather than a missing channel.
 */
export async function syncTrayUpdateCount(state: TrayBadgeState = 'pending'): Promise<void> {
	if (!isTauri()) return;

	try {
		const installation = session.getSelectedWowInstallation();
		const addons = installation
			? await addonService.getAllAddonsAvailableForUpdate(installation)
			: [];

		const names = addons.map((addon) => addon.name).slice(0, TRAY_MAX_ADDONS);
		if (addons.length > names.length) {
			names.push(
				i18n.t('PAGES.MY_ADDONS.UPDATE_ALL_TOOLTIP_MORE', {
					count: addons.length - names.length
				})
			);
		}

		await invoke(
			IPC_SET_TRAY_UPDATE_COUNT,
			addons.length,
			updateAllLabel(addons.length),
			state,
			names
		);
	} catch (e) {
		console.error('Failed to update the tray count', e);
	}
}

/**
 * Colour the badge for the duration of an update run: amber while it works, green when it
 * finishes, then back to whatever is actually left — which after a successful run is nothing,
 * so the badge clears itself.
 */
export async function withTrayRunState<T>(run: () => Promise<T>): Promise<T> {
	await syncTrayUpdateCount('running');
	try {
		const result = await run();
		await syncTrayUpdateCount('done');
		// Long enough to register as "that worked" without lingering as a status light.
		setTimeout(() => void syncTrayUpdateCount(), DONE_BADGE_MS);
		return result;
	} catch (e) {
		// Back to pending: the run failed, so whatever is left really is still waiting.
		await syncTrayUpdateCount();
		throw e;
	}
}

const DONE_BADGE_MS = 4000;
