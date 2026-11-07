// Hiding a provider hides its rows, and is remembered; a hidden provider stays in the menu
// even when the current list has none of its addons, so it can be brought back.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
vi.mock('$lib/services/storage', () => ({
	preferenceStorage: {
		getObjectAsync: (key: string) => Promise.resolve(stored.get(key)),
		setAsync: (key: string, value: unknown) => {
			stored.set(key, value);
			return Promise.resolve();
		}
	}
}));

import { ProviderFilter } from './provider-filter.svelte';

const KEY = 'test_hidden_providers';
const rows = [{ p: 'Curse' }, { p: 'Wago' }, { p: 'Curse' }, { p: 'WowInterface' }];
const providerOf = (row: { p: string }) => row.p;

beforeEach(() => stored.clear());

describe('ProviderFilter', () => {
	it('shows everything until a provider is hidden', () => {
		const filter = new ProviderFilter(KEY);
		expect(filter.active).toBe(false);
		expect(filter.apply(rows, providerOf)).toBe(rows);
	});

	it('hides the rows of a hidden provider, and saves the choice', async () => {
		const filter = new ProviderFilter(KEY);
		await filter.set('Curse', false);

		expect(filter.active).toBe(true);
		expect(filter.apply(rows, providerOf).map(providerOf)).toEqual(['Wago', 'WowInterface']);
		expect(stored.get(KEY)).toEqual(['Curse']);
	});

	it('lists each provider with its count, sorted, and whether it is shown', async () => {
		const filter = new ProviderFilter(KEY);
		await filter.set('Wago', false);

		expect(filter.options(rows, providerOf)).toEqual([
			{ name: 'Curse', count: 2, shown: true },
			{ name: 'Wago', count: 1, shown: false },
			{ name: 'WowInterface', count: 1, shown: true }
		]);
	});

	it('keeps a hidden provider in the list when the rows have none of it', async () => {
		const filter = new ProviderFilter(KEY);
		await filter.set('GitHub', false);

		expect(filter.options(rows, providerOf)).toContainEqual({
			name: 'GitHub',
			count: 0,
			shown: false
		});
	});

	it('shows a provider again, and Show All clears the filter', async () => {
		const filter = new ProviderFilter(KEY);
		await filter.set('Curse', false);
		await filter.set('Wago', false);

		await filter.set('Curse', true);
		expect(filter.hidden).toEqual(['Wago']);

		await filter.showAll();
		expect(filter.active).toBe(false);
		expect(stored.get(KEY)).toEqual([]);
	});

	it('restores the saved choice, ignoring anything malformed', async () => {
		stored.set(KEY, ['Curse', 42, null]);
		const filter = new ProviderFilter(KEY);
		await filter.load();
		expect(filter.hidden).toEqual(['Curse']);

		stored.set('other', 'not a list');
		const other = new ProviderFilter('other');
		await other.load();
		expect(other.hidden).toEqual([]);
	});
});
