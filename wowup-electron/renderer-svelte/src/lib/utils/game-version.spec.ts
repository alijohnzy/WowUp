import { describe, expect, it } from 'vitest';
import { WowClientType } from 'wowup-lib-core';
import { formatGameVersions } from './game-version';

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

	it('shows a lone version without a count', () => {
		expect(formatGameVersions(['11.2.0'], WowClientType.Retail)).toBe('11.2.0');
		expect(formatGameVersions([], undefined)).toBe('');
	});
});
