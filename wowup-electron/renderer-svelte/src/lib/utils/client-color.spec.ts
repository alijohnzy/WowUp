// A client's color tells its addon tables apart from another client's, so every client type
// needs one, and no two may share it by default.

import { describe, expect, it } from 'vitest';
import { getEnumList, WowClientType } from 'wowup-lib-core';
import {
	accentStyle,
	clientColor,
	colorSwatches,
	DEFAULT_CLIENT_COLORS,
	defaultClientColor,
	isClientColor,
	textOnColor
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

describe('buttons in the client color', () => {
	it('labels them in whichever of white and near-black reads better', () => {
		expect(textOnColor('#e3b02a')).not.toBe('#ffffff'); // Classic's gold
		expect(textOnColor('#7cc63a')).not.toBe('#ffffff'); // fel green
		expect(textOnColor('#3e3fd3')).toBe('#ffffff'); // Night's own button blue
		expect(textOnColor('#000000')).toBe('#ffffff');
		expect(textOnColor('#ffffff')).not.toBe('#ffffff');
	});

	it("redefines the theme's accents in the color", () => {
		const style = accentStyle('#e3b02a')!;
		expect(style).toContain('--background-primary: #e3b02a');
		expect(style).toContain('--control-color: #e3b02a');
		expect(style).toContain(`--text-on-primary: ${textOnColor('#e3b02a')}`);
	});

	it('leaves the theme alone without a color', () => {
		expect(accentStyle(undefined)).toBeUndefined();
		expect(accentStyle('red; color: x')).toBeUndefined();
	});
});
