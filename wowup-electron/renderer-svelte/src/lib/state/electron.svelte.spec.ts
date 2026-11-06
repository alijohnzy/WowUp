// Under Tauri, start() used to return before registering anything, so the update events
// src-tauri/src/updater.rs emits were dropped and the footer never offered an update.

import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (e: unknown, payload: unknown) => void>();

vi.mock('$lib/ipc', () => ({
	isElectron: () => false,
	isTauri: () => true,
	invoke: vi.fn(() => Promise.resolve(undefined)),
	send: vi.fn(),
	on: (channel: string, fn: (e: unknown, payload: unknown) => void) => {
		handlers.set(channel, fn);
		return () => handlers.delete(channel);
	}
}));

import { IPC_APP_UPDATE_STATE } from '$common/constants';
import { AppUpdateState } from '$common/wowup/models';
import { electron } from './electron.svelte';

describe('electron.start under Tauri', () => {
	it('listens for app update state', () => {
		electron.start();
		const handler = handlers.get(IPC_APP_UPDATE_STATE);
		expect(handler).toBeDefined();

		handler!({}, { state: AppUpdateState.UpdateAvailable, version: '2.25.4+18', manual: false });
		expect(electron.appUpdate?.state).toBe(AppUpdateState.UpdateAvailable);
		expect(electron.appUpdate?.version).toBe('2.25.4+18');
	});

	it('does not wire the Electron-only window channels', () => {
		expect([...handlers.keys()]).toEqual([IPC_APP_UPDATE_STATE]);
	});
});
