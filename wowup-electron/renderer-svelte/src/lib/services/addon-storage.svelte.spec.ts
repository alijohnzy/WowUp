// Pins the IPC channel each addon-storage call uses.
//
// These are the boundary between the renderer and the main process: a wrong or undefined
// channel name does not throw, it just resolves to undefined and surfaces much later as
// "cannot read properties of undefined" somewhere else entirely. That is exactly how a
// mis-stubbed channel presented while porting My Addons.

import { beforeEach, describe, expect, it } from 'vitest';
import * as addonStorage from './addon-storage';
import type { Addon } from 'wowup-lib-core';

interface Call {
	channel: string;
	args: unknown[];
}

let calls: Call[] = [];

beforeEach(() => {
	calls = [];
	(window as unknown as Record<string, unknown>).wowup = {
		rendererInvoke: (channel: string, ...args: unknown[]) => {
			calls.push({ channel, args });
			return Promise.resolve([]);
		},
		rendererSend: () => {},
		rendererSendSync: () => undefined,
		rendererOn: () => {},
		rendererOff: () => {},
		onRendererEvent: () => {},
		openExternal: () => Promise.resolve(),
		openPath: () => Promise.resolve('')
	};
});

describe('addon-storage IPC channels', () => {
	it('getAllForInstallationIdAsync uses addons-get-all-for-installation', async () => {
		await addonStorage.getAllForInstallationIdAsync('inst-1');
		expect(calls).toEqual([{ channel: 'addons-get-all-for-installation', args: ['inst-1'] }]);
	});

	it('getAll uses addons-get-all', async () => {
		await addonStorage.getAll();
		expect(calls[0].channel).toBe('addons-get-all');
	});

	it('getAvailableForUpdate uses addons-get-available-for-update', async () => {
		await addonStorage.getAvailableForUpdate('inst-1');
		expect(calls[0]).toEqual({
			channel: 'addons-get-available-for-update',
			args: ['inst-1']
		});
	});

	it('getAutoUpdateEnabled uses addons-get-auto-update-enabled', async () => {
		await addonStorage.getAutoUpdateEnabled();
		expect(calls[0].channel).toBe('addons-get-auto-update-enabled');
	});

	it('saveAll uses addons-save-all', async () => {
		await addonStorage.saveAll([]);
		expect(calls[0].channel).toBe('addons-save-all');
	});

	it('getAllForProviderAsync uses addons-get-all-for-provider', async () => {
		await addonStorage.getAllForProviderAsync('WowUpHub');
		expect(calls[0]).toEqual({ channel: 'addons-get-all-for-provider', args: ['WowUpHub'] });
	});

	it('setAsync writes through the generic store channel', async () => {
		await addonStorage.setAsync('key-1', { id: 'key-1' } as Addon);
		expect(calls[0].channel).toBe('store-set-object');
		expect(calls[0].args[0]).toBe('addons');
	});

	it('setAsync with no key is a no-op', async () => {
		await addonStorage.setAsync(undefined, {} as Addon);
		expect(calls).toHaveLength(0);
	});

	it('never invokes an undefined channel', async () => {
		await addonStorage.getAll();
		await addonStorage.getAllForInstallationIdAsync('x');
		await addonStorage.getAvailableForUpdate();
		await addonStorage.getAutoUpdateEnabled();
		await addonStorage.getByExternalIds(['a']);

		for (const call of calls) {
			expect(typeof call.channel, JSON.stringify(call)).toBe('string');
			expect(call.channel.length).toBeGreaterThan(0);
		}
	});
});
