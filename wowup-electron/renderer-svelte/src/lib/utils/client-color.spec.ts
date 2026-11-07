// A client's color tells its addon tables apart from another client's, so every client type
// needs one, and no two may share it by default.

import { describe, expect, it } from 'vitest';
import { getEnumList, WowClientType } from 'wowup-lib-core';
import {
	clientColor,
	colorSwatches,
	DEFAULT_CLIENT_COLORS,
	defaultClientColor,
	isClientColor
} from './client-color';

const clientTypes = (getEnumList(WowClientType) as WowClientType[]).filter(
	(type) => type !== WowClientType.None
);

describe('default client colors', () => {
	it('gives every client type a color', () => {
		for (const type of clientTypes) expect(isClientColor(defaultClientColor(type))).toBe(true);
	});

	it('gives no two client types the same color', () => {
		const colors = clientTypes.map((type) => DEFAULT_CLIENT_COLORS[type]);
		expect(new Set(colors).size).toBe(colors.length);
	});

	it('has none for an unknown client', () => {
		expect(defaultClientColor(WowClientType.None)).toBeUndefined();
		expect(defaultClientColor(undefined)).toBeUndefined();
	});
});

describe('colorSwatches', () => {
	it("offers every client type's color once, the client's own first", () => {
		const swatches = colorSwatches(WowClientType.ClassicEra);
		expect(swatches).toHaveLength(clientTypes.length);
		expect(swatches[0]).toEqual({ color: '#e3b02a', clientType: WowClientType.ClassicEra });
		expect(new Set(swatches.map((s) => s.clientType)).size).toBe(clientTypes.length);
	});
});

describe('clientColor', () => {
	it("uses the client type's color until one is chosen", () => {
		expect(clientColor({ clientType: WowClientType.Classic })).toBe('#22b89a');
		expect(clientColor({ clientType: WowClientType.Classic, color: '#ABCDEF' })).toBe('#abcdef');
	});

	it('ignores a stored value that is not a color', () => {
		for (const color of ['', 'red', '#abc', '#abcdefg', 'url(x)']) {
			expect(clientColor({ clientType: WowClientType.Retail, color })).toBe('#9d6cff');
		}
	});

	it('has none without an installation', () => {
		expect(clientColor(undefined)).toBeUndefined();
	});
});
