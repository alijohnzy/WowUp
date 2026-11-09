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
import type { WowInstallation } from 'wowup-lib-core';
import { invoke, isDesktop, isElectron, isTauri } from '$lib/ipc';
import { addonService } from '$lib/state/addon.svelte';
import { session } from '$lib/state/session.svelte';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
import { t, i18n } from '$lib/i18n.svelte';

export async function createAppMenu(): Promise<void> {
	// create-app-menu has no Tauri command yet (Group I); Tauri also has no menu bar on a
	// decorationless window, so there is nothing to show even once it lands.
	if (!isElectron()) return;

	const config: MenuConfig = {
		quitLabel: t('APP.APP_MENU.QUIT'),
		// macOS only enables Cmd+H, Cmd+Alt+H and Cmd+M through menu items with these roles.
		hideLabel: t('APP.APP_MENU.HIDE'),
		hideOthersLabel: t('APP.APP_MENU.HIDE_OTHERS'),
		showAllLabel: t('APP.APP_MENU.SHOW_ALL'),

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
		windowCloseLabel: t('APP.APP_MENU.WINDOW.CLOSE'),
		windowMinimizeLabel: t('APP.APP_MENU.WINDOW.MINIMIZE'),
		windowZoomLabel: t('APP.APP_MENU.WINDOW.ZOOM'),
		windowBringAllToFrontLabel: t('APP.APP_MENU.WINDOW.BRING_ALL_TO_FRONT')
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
		checkUpdateLabel: t('PAGES.MY_ADDONS.CHECK_UPDATES_BUTTON'),
		showLabel: t('APP.SYSTEM_TRAY.SHOW_ACTION'),
		updateAllLabel: t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON'),
		appUpdateLabel: t('APP.SYSTEM_TRAY.UPDATE_APP')
	};

	try {
		await invoke(IPC_CREATE_TRAY_MENU_CHANNEL, config);
		// The item is built disabled and unnumbered; this is what fills it in.
		await syncTrayUpdateCount();
	} catch (e) {
		console.error('Failed to create tray', e);
	}
}

/**
 * The tray's addon item: "Update All (4)" while something is pending, and otherwise the in-app
 * Check Updates, which it then runs (src-tauri/src/tray.rs picks the action by the count).
 */
function addonItemLabel(count: number): string {
	if (checking) return t('APP.SYSTEM_TRAY.CHECKING_UPDATES');
	if (count > 0) return `${t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON')} (${count})`;
	return t('PAGES.MY_ADDONS.CHECK_UPDATES_BUTTON');
}

/** What the badge is saying, which decides its colour. Mirrors BadgeState in tray.rs. */
export type TrayBadgeState = 'pending' | 'running' | 'done';

/** Names listed under the tray's Update All. Long lists make the menu unusable. */
const TRAY_MAX_ADDONS = 10;

/**
 * The clients the tray's Update All acts on: the selected one, as the Update All button does,
 * plus every client set to update from the tray (Options > Clients). In the user's order.
 *
 * The count, the names under the menu item and the click all go through this, so the tray
 * never promises more — or less — than clicking it does.
 */
export function trayInstallations(): WowInstallation[] {
	const selectedId = session.getSelectedWowInstallation()?.id;
	return warcraftInstallations.installations.filter(
		(installation) => installation.id === selectedId || installation.updateFromTray === true
	);
}

/**
 * The colour an update run gives the badge, while it lasts. Every addon that finishes redoes the
 * count, and each of those redraws went out as 'pending', so the badge turned back to red after
 * the first addon and the run only showed as a count going down.
 */
let runState: TrayBadgeState | undefined;
let runStateTimer: ReturnType<typeof setTimeout> | undefined;
/** The tray's Check Updates is running; its item says so and cannot be clicked again. */
let checking = false;

/**
 * Show the number of pending updates on the tray icon and in its menu, across
 * trayInstallations(), coloured by the update run in progress if there is one.
 *
 * Electron's tray has no such item, so this is a no-op there rather than a missing channel.
 */
export async function syncTrayUpdateCount(): Promise<void> {
	if (!isTauri()) return;

	try {
		const pending: { name: string; client: string; clientId: string }[] = [];
		for (const installation of trayInstallations()) {
			for (const addon of await addonService.getAllAddonsAvailableForUpdate(installation)) {
				pending.push({
					name: addon.name,
					client: installation.displayName,
					clientId: installation.id
				});
			}
		}

		// The same addon is often installed in several clients, so once more than one has
		// something to update, each name says which client it is in.
		const tagClients = new Set(pending.map((p) => p.clientId)).size > 1;
		const names = pending
			.slice(0, TRAY_MAX_ADDONS)
			.map((p) => (tagClients ? `${p.name} (${p.client})` : p.name));
		if (pending.length > names.length) {
			names.push(
				i18n.t('PAGES.MY_ADDONS.UPDATE_ALL_TOOLTIP_MORE', {
					count: pending.length - names.length
				})
			);
		}

		// Read after the awaits above: a refresh started by the last addon of a run can finish
		// after the run has turned the badge green, and must not paint it amber again.
		await invoke(
			IPC_SET_TRAY_UPDATE_COUNT,
			pending.length,
			addonItemLabel(pending.length),
			runState ?? 'pending',
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
	// A run started while the last one's green is showing must not be turned red by its timer.
	clearTimeout(runStateTimer);
	runState = 'running';
	await syncTrayUpdateCount();
	try {
		const result = await run();
		runState = 'done';
		await syncTrayUpdateCount();
		// Long enough to register as "that worked" without lingering as a status light.
		runStateTimer = setTimeout(() => {
			runState = undefined;
			void syncTrayUpdateCount();
		}, DONE_BADGE_MS);
		return result;
	} catch (e) {
		// Back to pending: the run failed, so whatever is left really is still waiting.
		runState = undefined;
		await syncTrayUpdateCount();
		throw e;
	}
}

const DONE_BADGE_MS = 4000;

/**
 * The tray's Check Updates, for the duration of the check: the item reads "Checking for
 * updates…" and is disabled, then turns into Update All if anything was found — that and the
 * badge appearing are the answer, since the window stays hidden. No green at the end: a check
 * that found updates has left them pending, not done.
 */
export async function withTrayCheck<T>(run: () => Promise<T>): Promise<T> {
	clearTimeout(runStateTimer);
	checking = true;
	runState = 'running';
	await syncTrayUpdateCount();
	try {
		return await run();
	} finally {
		checking = false;
		runState = undefined;
		await syncTrayUpdateCount();
	}
}
