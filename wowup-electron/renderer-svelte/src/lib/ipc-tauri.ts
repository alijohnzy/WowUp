// Tauri backend for the IPC seam. Selected at runtime by $lib/ipc; nothing outside that
// file should import this directly.
//
// Two things differ from Electron's IPC and neither fails loudly on its own:
//
//   1. Arguments are named, not positional. `ipcRenderer.invoke(ch, a, b)` becomes
//      `invoke(cmd, { first: a, second: b })`. An unknown or misspelled parameter name is
//      not an error — Tauri passes `None`/`undefined` for it. Hence CHANNEL_PARAMS below:
//      one explicit entry per channel that takes arguments.
//
//   2. The transport is JSON, not structured clone. Map, Set and Date do not survive.
//      Anything returning one needs a decoder — see warcraft-api.ts for the Map case.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { platform as osPlatform } from '@tauri-apps/plugin-os';
import { openUrl, openPath as tauriOpenPath } from '@tauri-apps/plugin-opener';

import {
	IPC_ADDONS_GET_ALL,
	IPC_ADDONS_GET_ALL_FOR_INSTALLATION,
	IPC_ADDONS_GET_ALL_FOR_PROVIDER,
	IPC_ADDONS_GET_AUTO_UPDATE_ENABLED,
	IPC_ADDONS_GET_AVAILABLE_FOR_UPDATE,
	IPC_ADDONS_GET_BY_EXTERNAL_ID,
	IPC_ADDONS_GET_BY_EXTERNAL_IDS,
	IPC_ADDONS_SAVE_ALL,
	IPC_GET_APP_VERSION,
	IPC_GET_ASSET_FILE_PATH,
	IPC_CLOSE_WINDOW,
	IPC_CREATE_TRAY_MENU_CHANNEL,
	IPC_FOCUS_WINDOW,
	IPC_GET_LOCALE,
	IPC_MAXIMIZE_WINDOW,
	IPC_MINIMIZE_WINDOW,
	IPC_COPY_FILE_CHANNEL,
	IPC_CURSE_GET_SCAN_RESULTS,
	IPC_DOWNLOAD_FILE_CHANNEL,
	IPC_UNZIP_FILE_CHANNEL,
	IPC_WOWUP_GET_SCAN_RESULTS,
	IPC_CREATE_DIRECTORY_CHANNEL,
	IPC_DELETE_DIRECTORY_CHANNEL,
	IPC_GET_HOME_DIR,
	IPC_GET_LATEST_DIR_UPDATE_TIME,
	IPC_LIST_FILES_CHANNEL,
	IPC_SHOW_DIRECTORY,
	IPC_STAT_FILES_CHANNEL,
	IPC_WRITE_FILE_CHANNEL,
	IPC_LIST_DIRECTORIES_CHANNEL,
	IPC_PATH_EXISTS_CHANNEL,
	IPC_READ_FILE_BUFFER_CHANNEL,
	IPC_READ_FILE_CHANNEL,
	IPC_READDIR,
	IPC_QUIT_APP,
	IPC_RESTART_APP,
	IPC_WINDOW_IS_FULLSCREEN,
	IPC_WINDOW_IS_MAXIMIZED,
	IPC_WINDOW_LEAVE_FULLSCREEN,
	IPC_IS_DEFAULT_PROTOCOL_CLIENT,
	IPC_REMOVE_AS_DEFAULT_PROTOCOL_CLIENT,
	IPC_SET_AS_DEFAULT_PROTOCOL_CLIENT,
	IPC_UPDATE_APP_BADGE,
	IPC_STORE_GET_ALL,
	IPC_STORE_GET_OBJECT,
	IPC_STORE_REMOVE_OBJECT,
	IPC_STORE_SET_OBJECT,
	IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH,
	IPC_WARCRAFT_GET_CLIENT_TYPE_FOR_BINARY,
	IPC_WARCRAFT_GET_EXECUTABLE_EXTENSION,
	IPC_WARCRAFT_GET_EXECUTABLE_NAME,
	IPC_WARCRAFT_GET_INSTALLED_PRODUCTS,
	IPC_WARCRAFT_IS_WOW_APPLICATION
} from '$common/constants';

/**
 * Channels served by a Rust command, and the parameter names that command expects.
 *
 * Presence in this table is what marks a channel as migrated — `invoke` throws for anything
 * absent. That is deliberate: the alternative is an unimplemented channel resolving to
 * `undefined`, which this codebase has been bitten by before (an empty addon grid reads as
 * "no addons", not as "the call did nothing").
 *
 * Channel names are kebab-case and the Rust commands are the same name in snake_case, so
 * the command is derived rather than listed. Zero-argument channels map to an empty array.
 */
export const CHANNEL_PARAMS: Readonly<Record<string, readonly string[]>> = {
	// Phase 0 — Warcraft platform detection (app/controllers/warcraft/).
	[IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH]: [],
	[IPC_WARCRAFT_GET_INSTALLED_PRODUCTS]: ['agentPath'],
	[IPC_WARCRAFT_GET_EXECUTABLE_NAME]: ['clientType'],
	[IPC_WARCRAFT_GET_CLIENT_TYPE_FOR_BINARY]: ['binaryPath'],
	[IPC_WARCRAFT_IS_WOW_APPLICATION]: ['appName'],
	[IPC_WARCRAFT_GET_EXECUTABLE_EXTENSION]: [],

	// Phase 1 — key/value stores (app/stores.ts) and app version.
	[IPC_STORE_GET_OBJECT]: ['storeName', 'key'],
	[IPC_STORE_GET_ALL]: ['storeName'],
	[IPC_STORE_SET_OBJECT]: ['storeName', 'key', 'value'],
	[IPC_STORE_REMOVE_OBJECT]: ['storeName', 'key'],
	[IPC_GET_APP_VERSION]: [],
	[IPC_GET_ASSET_FILE_PATH]: ['fileName'],
	[IPC_GET_LOCALE]: [],
	[IPC_UPDATE_APP_BADGE]: ['count'],
	[IPC_IS_DEFAULT_PROTOCOL_CLIENT]: ['protocol'],
	[IPC_SET_AS_DEFAULT_PROTOCOL_CLIENT]: ['protocol'],
	[IPC_REMOVE_AS_DEFAULT_PROTOCOL_CLIENT]: ['protocol'],

	// Phase 1 — addon database (app/controllers/addon.controller.ts).
	[IPC_ADDONS_GET_ALL]: [],
	[IPC_ADDONS_GET_ALL_FOR_INSTALLATION]: ['installationId'],
	[IPC_ADDONS_GET_ALL_FOR_PROVIDER]: ['providerName'],
	[IPC_ADDONS_GET_BY_EXTERNAL_ID]: ['externalId', 'providerName', 'installationId'],
	[IPC_ADDONS_GET_BY_EXTERNAL_IDS]: ['externalIds'],
	[IPC_ADDONS_GET_AVAILABLE_FOR_UPDATE]: ['installationId'],
	[IPC_ADDONS_GET_AUTO_UPDATE_ENABLED]: [],
	[IPC_ADDONS_SAVE_ALL]: ['addons'],

	// Phase 1 — window controls (Group G). The window is decorationless, so the app's own
	// titlebar is the only way to minimise, maximise or close it.
	[IPC_MINIMIZE_WINDOW]: [],
	[IPC_MAXIMIZE_WINDOW]: [],
	[IPC_CLOSE_WINDOW]: [],
	[IPC_FOCUS_WINDOW]: [],
	[IPC_WINDOW_IS_MAXIMIZED]: [],
	[IPC_WINDOW_IS_FULLSCREEN]: [],
	[IPC_WINDOW_LEAVE_FULLSCREEN]: [],
	[IPC_RESTART_APP]: [],
	[IPC_QUIT_APP]: [],
	[IPC_CREATE_TRAY_MENU_CHANNEL]: ['config'],

	// Phase 1 — filesystem (Group A), as far as the addon scanner needs.
	[IPC_PATH_EXISTS_CHANNEL]: ['filePath'],
	[IPC_READDIR]: ['dirPath'],
	[IPC_READ_FILE_CHANNEL]: ['filePath'],
	[IPC_READ_FILE_BUFFER_CHANNEL]: ['filePath'],
	[IPC_LIST_DIRECTORIES_CHANNEL]: ['filePath', 'scanSymlinks'],
	[IPC_GET_LATEST_DIR_UPDATE_TIME]: ['dirPath'],
	[IPC_CREATE_DIRECTORY_CHANNEL]: ['directoryPath'],
	[IPC_DELETE_DIRECTORY_CHANNEL]: ['filePath'],
	[IPC_WRITE_FILE_CHANNEL]: ['filePath', 'contents'],
	[IPC_GET_HOME_DIR]: [],
	[IPC_SHOW_DIRECTORY]: ['filePath'],
	[IPC_STAT_FILES_CHANNEL]: ['filePaths'],
	[IPC_LIST_FILES_CHANNEL]: ['sourcePath', 'filter'],
	// copy-file is invoked with one object argument (services/files.ts:77), not positionals,
	// so the Rust command takes a single `request` and destructures it there.
	[IPC_COPY_FILE_CHANNEL]: ['request'],

	// Phase 2 — addon folder scanners (Group C). These are what reconcile installedVersion
	// with what is actually on disk, so update detection depends on them.
	[IPC_CURSE_GET_SCAN_RESULTS]: ['filePaths'],
	[IPC_WOWUP_GET_SCAN_RESULTS]: ['filePaths'],

	// Phase 2 — install/update. Both take a single request object, and download-file replies
	// on the caller's own `responseKey` channel rather than by resolving.
	[IPC_DOWNLOAD_FILE_CHANNEL]: ['request'],
	// The ad frame is a child webview positioned by the renderer; see src-tauri/src/ad.rs.
	'ad-frame-open': ['url', 'userAgent', 'x', 'y', 'width', 'height'],
	'ad-frame-set-bounds': ['x', 'y', 'width', 'height'],
	[IPC_UNZIP_FILE_CHANNEL]: ['request']
};

/** `warcraft-get-executable-name` -> `warcraft_get_executable_name`. */
const commandName = (channel: string): string => channel.replace(/-/g, '_');

export class UnmigratedChannelError extends Error {
	constructor(readonly channel: string) {
		super(
			`IPC channel "${channel}" has no Tauri command yet. Add it to CHANNEL_PARAMS in ` +
				'src/lib/ipc-tauri.ts once the Rust side exists (see migration/tauri-scope.md).'
		);
		this.name = 'UnmigratedChannelError';
	}
}

function buildArgs(channel: string, args: unknown[]): Record<string, unknown> {
	const params = CHANNEL_PARAMS[channel];
	if (params === undefined) throw new UnmigratedChannelError(channel);

	if (args.length > params.length) {
		// Extra positional arguments would be dropped in silence otherwise.
		throw new Error(
			`IPC channel "${channel}" takes ${params.length} argument(s), got ${args.length}. ` +
				'CHANNEL_PARAMS is probably out of date with the Rust command.'
		);
	}

	const payload: Record<string, unknown> = {};
	params.forEach((name, i) => {
		payload[name] = args[i];
	});
	return payload;
}

// `async` so a bad channel or arity rejects rather than throwing synchronously. Electron's
// ipcRenderer.invoke always returns a promise, and `send` below relies on being able to
// attach a .catch — a synchronous throw would escape it and take down the caller instead.
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
	return tauriInvoke<T>(commandName(channel), buildArgs(channel, args));
}

/**
 * Electron's `send` is fire-and-forget with no reply. Tauri has no such primitive, so this
 * is an `invoke` whose result is discarded — but a rejection is still surfaced, because a
 * silently swallowed one is how a broken channel stays invisible.
 */
export function send(channel: string, ...args: unknown[]): void {
	invoke(channel, ...args).catch((e) => {
		console.error(`ipc send failed on "${channel}"`, e);
	});
}

export function sendSync<T>(channel: string): T {
	throw new Error(
		`Synchronous IPC is not available under Tauri (channel "${channel}"). ` +
			'Use the async equivalent.'
	);
}

/**
 * Electron hands the listener an `IpcRendererEvent` as the first argument and the payload
 * after it. Tauri delivers a single event object with a `payload`. The shim below restores
 * the Electron call shape so consumers do not have to care which backend is live.
 *
 * Rust emits payloads as an array when a channel carries more than one value.
 */
export function on(
	channel: string,
	listener: (event: unknown, ...args: never[]) => void
): () => void {
	let unlisten: (() => void) | undefined;
	let cancelled = false;

	// `listen` is async but the seam's `on` is synchronous, so an unsubscribe that lands
	// before the listener is registered has to be remembered rather than dropped.
	void listen(channel, (event) => {
		const payload = event.payload;
		const args = Array.isArray(payload) ? payload : payload === undefined ? [] : [payload];
		listener({}, ...(args as never[]));
	}).then((fn) => {
		if (cancelled) fn();
		else unlisten = fn;
	});

	return () => {
		cancelled = true;
		unlisten?.();
	};
}

export const openExternal = (url: string): Promise<void> => openUrl(url);

export const openPath = async (path: string): Promise<string> => {
	// Electron's shell.openPath resolves to an error string, or '' on success.
	try {
		await tauriOpenPath(path);
		return '';
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

/**
 * Tauri reports `macos`/`windows`; the renderer's isMac()/isWin() compare against Node's
 * `process.platform` values. Without this mapping both return false on every platform and
 * the app silently takes the Linux branch everywhere.
 */
export function platform(): string {
	switch (osPlatform()) {
		case 'macos':
			return 'darwin';
		case 'windows':
			return 'win32';
		default:
			return osPlatform();
	}
}

/**
 * Fetch the paths Electron injects through preload (`window.userDataPath`, `window.logPath`)
 * and hang them on `window` so the shell-agnostic code above can keep reading them.
 *
 * Must run before anything derives a path from them. Left unset they are `''`, and every
 * derived path — `downloads/`, `wtf_backups/`, the updater — becomes relative and resolves
 * against the working directory, which for a packaged AppImage is the read-only mount.
 */
export async function injectShellPaths(): Promise<void> {
	const paths = await tauriInvoke<{ userDataPath: string; logPath: string }>('get_app_paths');
	window.userDataPath = paths.userDataPath;
	window.logPath = paths.logPath;
}
