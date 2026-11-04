import { describe, expect, it } from 'vitest';
import { WowClientType } from 'wowup-lib-core';
import { formatGameVersions } from './game-version';
import { getFileTargetVersions } from './addon';

describe('formatGameVersions', () => {
	it('picks the retail version for a retail client', () => {
		expect(formatGameVersions(['1.15.7', '11.2.0'], WowClientType.Retail)).toBe('11.2.0, 1 +');
	});

	// Forever (1.6.x) and Classic Era (1.15.x) share major version 1, which is why the
	// lib's prefix became a string: a bare "1." would hand Forever the Era release.
	it('tells WoW Forever apart from Classic Era', () => {
		// Retail first, so a miss would fall back to it rather than land on the answer by luck.
		const versions = ['11.2.0', '1.6.0', '1.15.7'];
		expect(formatGameVersions(versions, WowClientType.Forever)).toBe('1.6.0, 2 +');
		expect(formatGameVersions(versions, WowClientType.ClassicEra)).toBe('1.15.7, 2 +');
	});

	it('falls back to the first version when none matches the flavor', () => {
		expect(formatGameVersions(['5.5.0', '11.2.0'], WowClientType.Forever)).toBe('5.5.0, 1 +');
	});

	// The lib still says Retail is "11." — Midnight is 12.x, so matching on that prefix found
	// nothing and fell back to whatever came first: BigWigs showed "1.15.8" under Retail.
	it('finds Retail versions whatever the current expansion number is', () => {
		const bigWigs = ['1.15.8', '1.15.9', '1.60.1', '2.5.6', '5.5.4', '12.1.0', '12.1.5', '12.1.7'];
		expect(formatGameVersions(bigWigs, WowClientType.Retail)).toBe('12.1.7, 7 +');
		expect(formatGameVersions(bigWigs, WowClientType.Beta)).toBe('12.1.7, 7 +');
	});

	it('shows the newest version of the flavour, and counts each other version once', () => {
		const stored = ['1.15.8', '12.1.0', '1.15.9', '12.1.0', '1.15.8'];
		expect(formatGameVersions(stored, WowClientType.ClassicEra)).toBe('1.15.9, 2 +');
	});

	it('shows a lone version without a count', () => {
		expect(formatGameVersions(['11.2.0'], WowClientType.Retail)).toBe('11.2.0');
		expect(formatGameVersions([], undefined)).toBe('');
	});
});

// One CurseForge file often serves every flavour. Its `gameVersions` lists them all, and
// `gameVersion` is just the first — for DBM that is Cataclysm's 4.4.2. Storing only that made
// an updated addon show a Cataclysm version under Retail and Forever alike.
describe('the Game Version column after an update', () => {
	// DBM-Core's latest file as CurseForge returned it for WoW Forever (2026-11-04).
	const dbm = {
		gameVersion: '4.4.2',
		gameVersions: [
			'4.4.2',
			'3.4.5',
			'5.5.4',
			'2.5.6',
			'1.15.9',
			'3.80.2',
			'12.1.5',
			'1.60.1',
			'12.1.7'
		]
	};
	const shown = (clientType: WowClientType) =>
		formatGameVersions(getFileTargetVersions(dbm), clientType).split(',')[0];

	it('shows the version for the client’s own flavour', () => {
		expect(shown(WowClientType.Forever)).toBe('1.60.1');
		expect(shown(WowClientType.Retail)).toBe('12.1.7');
		expect(shown(WowClientType.ClassicEra)).toBe('1.15.9');
	});

	it('still stores the one version a provider gives when that is all it has', () => {
		expect(getFileTargetVersions({ gameVersion: '1.60.1' })).toEqual(['1.60.1']);
		expect(getFileTargetVersions({ gameVersion: '' })).toEqual([]);
	});

	it('stores each version once', () => {
		expect(getFileTargetVersions({ gameVersions: ['12.1.5', '12.1.5', '1.60.1'] })).toEqual([
			'12.1.5',
			'1.60.1'
		]);
	});
});
