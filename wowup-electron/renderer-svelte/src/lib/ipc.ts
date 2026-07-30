// Thin wrapper over the existing Electron preload bridge (app/preload.ts).
//
// The preload is framework-agnostic — it exposes `window.wowup` with no Angular in
// sight — so the Svelte renderer reuses it unchanged. This file is the whole of what
// `ElectronService` (367 LOC of Angular DI + 7 BehaviorSubjects) did for IPC.

import type { IpcRendererEvent } from 'electron';

interface WowUpBridge {
	rendererInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
	rendererSend: (channel: string, ...args: unknown[]) => void;
	rendererSendSync: (channel: string, ...args: unknown[]) => unknown;
	rendererOn: (
		channel: string,
		listener: (event: IpcRendererEvent, ...args: never[]) => void
	) => void;
	rendererOff: (channel: string, listener: (...args: never[]) => void) => void;
	onRendererEvent: (
		channel: string,
		listener: (event: IpcRendererEvent, ...args: never[]) => void
	) => void;
	openExternal: (url: string) => Promise<void>;
	openPath: (path: string) => Promise<string>;
}

declare global {
	interface Window {
		wowup?: WowUpBridge;
		platform?: string;
		userDataPath?: string;
		logPath?: string;
	}
}

/** True when running inside Electron. False under Vitest/browser, so callers can stub. */
export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.wowup;

function bridge(): WowUpBridge {
	const b = typeof window !== 'undefined' ? window.wowup : undefined;
	if (!b) throw new Error('Electron preload bridge unavailable (window.wowup is undefined)');
	return b;
}

export function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
	return bridge().rendererInvoke(channel, ...args) as Promise<T>;
}

export function send(channel: string, ...args: unknown[]): void {
	bridge().rendererSend(channel, ...args);
}

export function sendSync<T>(channel: string, ...args: unknown[]): T {
	return bridge().rendererSendSync(channel, ...args) as T;
}

/**
 * Subscribe to a main-process channel. Returns an unsubscribe function, which makes it
 * drop straight into `$effect`:
 *
 *   $effect(() => on('window-maximized', handler));
 */
export function on(
	channel: string,
	listener: (event: IpcRendererEvent, ...args: never[]) => void
): () => void {
	const b = bridge();
	b.rendererOn(channel, listener);
	return () => b.rendererOff(channel, listener);
}

export const openExternal = (url: string): Promise<void> => bridge().openExternal(url);
export const openPath = (path: string): Promise<string> => bridge().openPath(path);

export const platform = (): string =>
	(typeof window !== 'undefined' && window.platform) || 'unknown';
export const isWin = (): boolean => platform() === 'win32';
export const isMac = (): boolean => platform() === 'darwin';
export const isLinux = (): boolean => platform() === 'linux';
