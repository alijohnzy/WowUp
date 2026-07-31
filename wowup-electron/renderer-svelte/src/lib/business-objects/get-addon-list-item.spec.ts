// One malformed release date used to blank the whole Get Addons grid.
//
// `releasedAt` is epoch milliseconds. When a provider returned a release date Date could
// not parse, `getTime()` gave NaN, and the grid's value formatter did
// `new Date(NaN).toISOString()` — which throws RangeError. Because that runs inside
// ag-grid's render loop, the grid was left "in the middle of drawing rows" and rendered
// *none* of them, while the footer still said "55 results". An empty table with a non-zero
// count is a confusing way to be told one row had a bad date.

import { describe, expect, it } from 'vitest';
import { AddonChannelType } from 'wowup-lib-core';
import type { AddonSearchResult } from 'wowup-lib-core';
import { GetAddonListItem } from './get-addon-list-item';
import { getRelativeDateFormat } from '$lib/utils/string';

function searchResult(releaseDate: unknown): AddonSearchResult {
	return {
		name: 'WeakAuras',
		author: 'someone',
		externalId: '1',
		externalUrl: 'https://example.test',
		providerName: 'curseforge',
		downloadCount: 1,
		files: [
			{
				channelType: AddonChannelType.Stable,
				version: '1.0.0',
				releaseDate,
				downloadUrl: 'https://example.test/f.zip',
				folders: [],
				gameVersion: '11.0.0',
				dependencies: []
			}
		]
	} as unknown as AddonSearchResult;
}

describe('GetAddonListItem.releasedAt', () => {
	it('is a usable number when the provider sends an unparseable release date', () => {
		const item = new GetAddonListItem(searchResult('not a date'), AddonChannelType.Stable);

		expect(Number.isNaN(item.releasedAt)).toBe(false);
	});

	it('survives a null release date', () => {
		const item = new GetAddonListItem(searchResult(null), AddonChannelType.Stable);

		expect(Number.isNaN(item.releasedAt)).toBe(false);
	});

	it('keeps a real release date intact', () => {
		const item = new GetAddonListItem(
			searchResult('2026-01-02T03:04:05.000Z'),
			AddonChannelType.Stable
		);

		expect(item.releasedAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
	});
});

describe('the Get Addons released-at formatter', () => {
	// Mirrors the column's valueFormatter. The point is that it must not throw for any
	// releasedAt a GetAddonListItem can hold — ag-grid gives no isolation per cell.
	const format = (releasedAt: number) => getRelativeDateFormat(releasedAt);

	it('does not throw for a zeroed date', () => {
		expect(() => format(0)).not.toThrow();
		expect(format(0)[0]).toBe('');
	});

	it('does not throw for NaN, whatever produced it', () => {
		expect(() => format(Number.NaN)).not.toThrow();
		expect(format(Number.NaN)[0]).toBe('');
	});

	it('still formats a real date', () => {
		const [key] = format(Date.now() - 3 * 24 * 60 * 60 * 1000);
		expect(key).toBe('COMMON.DATES.DAYS_AGO');
	});
});
