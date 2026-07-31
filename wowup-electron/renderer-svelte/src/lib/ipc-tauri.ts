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
	[IPC_WARCRAFT_GET_EXECUTABLE_EXTENSION]: []
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
