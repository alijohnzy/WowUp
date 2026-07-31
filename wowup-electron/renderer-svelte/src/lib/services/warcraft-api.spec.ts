// The structured-clone/JSON gap, asserted at the level the app actually cares about.
//
// Electron's IPC preserves a Map; Tauri's JSON transport does not. The consumer
// (warcraft.svelte.ts:58) only ever calls `.get()`, so a plain object would not throw — it
// would return undefined for every client type, and the app would report that no WoW
// installation exists. These tests assert the lookup works for both wire shapes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('$lib/ipc', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { WowClientType } from 'wowup-lib-core';
import type { InstalledProduct } from 'wowup-lib-core';
import { getInstalledProducts } from './warcraft-api';

const retail: InstalledProduct = {
	name: '_retail_',
	location: '/wow/_retail_',
	clientType: WowClientType.Retail
};
const classic: InstalledProduct = {
	name: '_classic_',
	location: '/wow/_classic_',
	clientType: WowClientType.Classic
};

beforeEach(() => invokeMock.mockReset());

describe('getInstalledProducts', () => {
	it('returns a usable Map from Tauri entry pairs', async () => {
		invokeMock.mockResolvedValue([
			[WowClientType.Retail, retail],
			[WowClientType.Classic, classic]
		]);

		const products = await getInstalledProducts('/tmp/product.db');

		expect(products.get(WowClientType.Retail)?.location).toBe('/wow/_retail_');
		expect(products.get(WowClientType.Classic)?.location).toBe('/wow/_classic_');
	});

	it('returns a usable Map from an Electron Map', async () => {
		invokeMock.mockResolvedValue(
			new Map([
				[WowClientType.Retail, retail],
				[WowClientType.Classic, classic]
			])
		);

		const products = await getInstalledProducts('/tmp/product.db');

		expect(products.get(WowClientType.Retail)?.location).toBe('/wow/_retail_');
		expect(products.size).toBe(2);
	});

	it('yields an empty Map when no products are installed', async () => {
		invokeMock.mockResolvedValue([]);

		const products = await getInstalledProducts('');

		expect(products.size).toBe(0);
		expect(products.get(WowClientType.Retail)).toBeUndefined();
	});
});
