// Replaces app.component.ts's createAppMenu() (81 LOC) and createSystemTray() (21 LOC).
//
// Both exist only because the native menu bar and the tray menu are built in the main
// process but their labels are translated in the renderer — the renderer resolves the keys
// and ships a flat config object over IPC. That is the whole job, so it is a function
// rather than part of the app shell.

import { IPC_CREATE_APP_MENU_CHANNEL, IPC_CREATE_TRAY_MENU_CHANNEL } from '$common/constants';
import type { MenuConfig, SystemTrayConfig } from '$common/wowup/models';
import { invoke, isDesktop, isElectron } from '$lib/ipc';
import { t } from '$lib/i18n.svelte';

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
		showLabel: t('APP.SYSTEM_TRAY.SHOW_ACTION')
	};

	try {
		await invoke(IPC_CREATE_TRAY_MENU_CHANNEL, config);
	} catch (e) {
		console.error('Failed to create tray', e);
	}
}
