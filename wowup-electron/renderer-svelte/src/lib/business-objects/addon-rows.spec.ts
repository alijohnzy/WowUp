// Covers the branch the port had lost: an install finishing repainted the cell instead of
// replacing the row's view model, so a finished update kept its old version in every column
// but the status one, and stayed in the Update group until the page was reloaded.

import { describe, expect, it } from 'vitest';
import { AddonStatusSortOrder } from '$lib/models/addon-status-sort-order';
import { AddonViewModel } from './addon-view-model';
import { withInstalledAddon } from './addon-rows';
import type { Addon } from 'wowup-lib-core';

const addon = (name: string, installedVersion: string, latestVersion: string): Addon =>
	({
		id: `id-${name}`,
		name,
		installationId: 'inst-1',
		installedVersion,
		latestVersion,
		isIgnored: false,
		dependencies: [],
		externalIds: []
	}) as unknown as Addon;

describe('withInstalledAddon', () => {
	it('replaces the row so it leaves the Update group', () => {
		const rows = [new AddonViewModel(addon('Zulu', '1.0.0', '2.0.0'))];
		expect(rows[0].sortOrder).toBe(AddonStatusSortOrder.Update);

		const next = withInstalledAddon(rows, addon('Zulu', '2.0.0', '2.0.0'), true);

		expect(next).toHaveLength(1);
		expect(next[0].sortOrder).toBe(AddonStatusSortOrder.UpToDate);
		// A new model, not the old one mutated — ag-grid diffs row data by identity.
		expect(next[0]).not.toBe(rows[0]);
		expect(next[0].addon?.installedVersion).toBe('2.0.0');
	});

	it('leaves the other rows alone', () => {
		const alpha = new AddonViewModel(addon('Alpha', '1.0.0', '1.0.0'));
		const rows = [alpha, new AddonViewModel(addon('Zulu', '1.0.0', '2.0.0'))];

		const next = withInstalledAddon(rows, addon('Zulu', '2.0.0', '2.0.0'), true);

		expect(next[0]).toBe(alpha);
	});

	it('appends an addon installed elsewhere, in name order', () => {
		const rows = [
			new AddonViewModel(addon('Alpha', '1.0.0', '1.0.0')),
			new AddonViewModel(addon('Zulu', '1.0.0', '1.0.0'))
		];

		const next = withInstalledAddon(rows, addon('Mike', '1.0.0', '1.0.0'), true);

		expect(next.map((r) => r.addon?.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
	});

	it('ignores an unknown addon that is still installing', () => {
		const rows = [new AddonViewModel(addon('Alpha', '1.0.0', '1.0.0'))];

		// Angular's guard: a half-installed addon should not appear as a row.
		expect(withInstalledAddon(rows, addon('Mike', '', ''), false)).toBe(rows);
	});
});
