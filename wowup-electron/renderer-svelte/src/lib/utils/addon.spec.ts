// Ported from src/app/utils/tests/addon.utils.spec.ts (Jasmine/Karma -> vitest).
//
// Same assertions, same inputs. The point of carrying these over verbatim is that they
// verify the port preserved behaviour rather than testing what the new code happens to do.
// Jasmine's `expect(fn).toThrow(new Error(msg))` becomes `.toThrowError(msg)`.

import { describe, expect, it } from 'vitest';
import { getGameVersion } from 'wowup-lib-core';
import { needsUpdate, toInterfaceVersion } from './addon';
import type { Addon } from 'wowup-lib-core';

describe('getGameVersion (wowup-lib-core, unchanged by the migration)', () => {
	it.each([
		['90102', '9.1.2'],
		['91122', '9.11.22'],
		['9.11.22', '9.11.22'],
		['100102', '10.1.2'],
		['101122', '10.11.22']
	])('converts %s -> %s', (input, expected) => {
		expect(getGameVersion(input)).toEqual(expected);
	});

	it('accepts empty string', () => {
		expect(getGameVersion('')).toEqual('0.0.0');
	});

	it('accepts undefined', () => {
		expect(getGameVersion(undefined)).toEqual('0.0.0');
	});
});

describe('toInterfaceVersion', () => {
	it.each([
		['9.1.2', '90102'],
		['10.0', '100000'],
		['9.11.22', '91122'],
		['90102', '90102'],
		['10.1.2', '100102'],
		['10.11.22', '101122']
	])('converts %s -> %s', (input, expected) => {
		expect(toInterfaceVersion(input)).toEqual(expected);
	});

	it('throws on empty string', () => {
		expect(() => toInterfaceVersion('')).toThrowError('interface version empty or undefined');
	});

	it('throws on undefined', () => {
		expect(() => toInterfaceVersion(undefined as unknown as string)).toThrowError(
			'interface version empty or undefined'
		);
	});
});

// Not covered by the Angular suite. needsUpdate drives the update badge on every row of
// My Addons, so it is worth pinning down.
describe('needsUpdate', () => {
	const addon = (props: Partial<Addon>): Addon => props as Addon;

	it('is false for undefined', () => {
		expect(needsUpdate(undefined)).toBe(false);
	});

	it('is false when the addon is ignored', () => {
		expect(needsUpdate(addon({ isIgnored: true, installedVersion: '1', latestVersion: '2' }))).toBe(
			false
		);
	});

	it('is true when the external release id moved but the version did not', () => {
		expect(
			needsUpdate(
				addon({
					externalLatestReleaseId: 'b',
					installedExternalReleaseId: 'a',
					installedVersion: '1.0',
					latestVersion: '1.0'
				})
			)
		).toBe(true);
	});

	it('ignores a leading v when comparing versions', () => {
		expect(needsUpdate(addon({ installedVersion: 'v1.0', latestVersion: '1.0' }))).toBe(false);
		expect(needsUpdate(addon({ installedVersion: 'v1.0', latestVersion: '1.1' }))).toBe(true);
	});

	it('is false when nothing is installed', () => {
		expect(needsUpdate(addon({ installedVersion: '', latestVersion: '1.0' }))).toBe(false);
	});
});
