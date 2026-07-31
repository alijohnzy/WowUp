// The renderer's only coupling to a desktop shell.
//
// Originally a thin wrapper over Electron's preload bridge (app/preload.ts). It now selects
// between that and Tauri (src/lib/ipc-tauri.ts) at runtime, so both shells can be built from
// one renderer while the migration proceeds — the same pattern the Angular/Svelte split
// already uses. Everything above this file is shell-agnostic; see migration/tauri-scope.md.

import type { IpcRendererEvent } from 'electron';
import * as tauri from '$lib/ipc-tauri';

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
		/** Injected by Tauri's IPC bootstrap; presence is how we detect the shell. */
		__TAURI_INTERNALS__?: unknown;
	}
}

/** True when running inside Electron. False under Vitest/browser, so callers can stub. */
export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.wowup;

/** True when running inside Tauri. */
export const isTauri = (): boolean => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

/**
 * True when any desktop shell is present, i.e. when native features are available at all.
 *
 * Most existing `isElectron()` guards mean this rather than "Electron specifically" — they
 * gate menus, tray, zoom, auto-update and push. They are being moved over to `isDesktop()`
 * one phase at a time, as the Rust command behind each lands; a guard flipped early would
 * invoke an unmigrated channel and throw. `migration/tauri-scope.md` tracks which remain.
 */
export const isDesktop = (): boolean => isElectron() || isTauri();

// Electron is checked first so the existing E2E harness — which stubs `window.wowup` and
// nothing else — keeps exercising the Electron path unchanged.
const useTauri = (): boolean => !isElectron() && isTauri();

/**
 * Marks <html> with the active shell so stylesheets can branch on it.
 *
 * Needed because `-webkit-app-region` means different things in the two shells. Electron
 * implements it fully. WebKitGTK parses it but honours only the "this area is not
 * interactive" half, so a drag region defined that way swallows clicks under Tauri while
 * dragging nothing — which is what made the titlebar dead and the area under it unclickable.
 *
 * Defined after `useTauri` on purpose: it is a const arrow, so it does not hoist.
 */
export function markShellOnDocument(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('tauri', useTauri());
	document.documentElement.classList.toggle('electron', isElectron());
}

/**
 * Stops the webview's own context menu from opening.
 *
 * Electron shows no context menu unless the app builds one, so every right-click in this app
 * is already owned: addon rows, grid headers and the menu backdrop each open their own.
 * WebKitGTK does show one, so under Tauri a right-click produced the app's menu with a
 * native "Reload / Inspect Element" menu over the top — and on anything without a handler,
 * such as the nav rail or empty grid space, only the native one.
 *
 * Registered in the **capture** phase so it runs before the component handlers. Those still
 * run and still open their menus; this only removes the default action. Capture also means a
 * handler calling `stopPropagation()` cannot let the native menu slip through, which matters
 * because ag-grid's cell handler does not `preventDefault()` itself.
 *
 * Returns an unsubscribe.
 */
export function suppressNativeContextMenu(): () => void {
	if (typeof document === 'undefined') return () => {};

	const handler = (e: Event) => e.preventDefault();
	document.addEventListener('contextmenu', handler, { capture: true });
	return () => document.removeEventListener('contextmenu', handler, { capture: true });
}

function bridge(): WowUpBridge {
	const b = typeof window !== 'undefined' ? window.wowup : undefined;
	if (!b) throw new Error('Electron preload bridge unavailable (window.wowup is undefined)');
	return b;
}

export function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
	if (useTauri()) return tauri.invoke<T>(channel, ...args);
	return bridge().rendererInvoke(channel, ...args) as Promise<T>;
}

export function send(channel: string, ...args: unknown[]): void {
	if (useTauri()) return tauri.send(channel, ...args);
	bridge().rendererSend(channel, ...args);
}

export function sendSync<T>(channel: string, ...args: unknown[]): T {
	if (useTauri()) return tauri.sendSync<T>(channel);
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
	if (useTauri()) return tauri.on(channel, listener as (e: unknown, ...a: never[]) => void);
	const b = bridge();
	b.rendererOn(channel, listener);
	return () => b.rendererOff(channel, listener);
}

export const openExternal = (url: string): Promise<void> =>
	useTauri() ? tauri.openExternal(url) : bridge().openExternal(url);

export const openPath = (path: string): Promise<string> =>
	useTauri() ? tauri.openPath(path) : bridge().openPath(path);

export const platform = (): string => {
	if (useTauri()) return tauri.platform();
	return (typeof window !== 'undefined' && window.platform) || 'unknown';
};

export const isWin = (): boolean => platform() === 'win32';
export const isMac = (): boolean => platform() === 'darwin';
export const isLinux = (): boolean => platform() === 'linux';
