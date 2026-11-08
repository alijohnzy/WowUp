import { describe, expect, it } from 'vitest';
import type { Addon, WowInstallation } from 'wowup-lib-core';
import { AddonFlavorIndex, identityKeys } from './addon-flavors';

const install = (id: string): WowInstallation => ({ id, displayName: id }) as WowInstallation;
const RETAIL = install('retail');
const CLASSIC = install('classic');
const ERA = install('era');
const ALL = [RETAIL, CLASSIC, ERA];

const addon = (installationId: string, fields: Partial<Addon>): Addon =>
	({ name: 'x', installationId, ...fields }) as Addon;

describe('identityKeys', () => {
	it('ignores provider-name case and skips empty ids and folders', () => {
		const keys = identityKeys({
			providerName: 'Curse',
			externalId: '1',
			externalIds: [
				{ providerName: 'Wago', id: 'abc' },
				{ providerName: 'Wago', id: '' }
			],
			installedFolderList: ['ElvUI', '']
		});
		expect(keys).toEqual(['id:curse|1', 'id:wago|abc', 'folder:elvui']);
	});
});

describe('AddonFlavorIndex', () => {
	const index = new AddonFlavorIndex([
		addon('retail', { providerName: 'Curse', externalId: '1', installedFolderList: ['DBM-Core'] }),
		addon('classic', {
			providerName: 'Wago',
			externalId: 'w1',
			externalIds: [{ providerName: 'curse', id: '1' }]
		}),
		addon('era', {
			providerName: 'Unknown',
			installedFolderList: ['dbm-core', 'DBM-StatusBarTimers']
		}),
		addon('era', { providerName: 'Curse', externalId: '2' })
	]);

	it('finds a search result by provider id, including alternative ids in other flavors', () => {
		const found = index.installationsWith({ providerName: 'Curse', externalId: '1' }, ALL);
		expect(found.map((i) => i.id)).toEqual(['retail', 'classic']);
	});

	it('finds an installed addon by folder too, whatever the provider', () => {
		const found = index.installationsWith({ installedFolderList: ['DBM-Core'] }, ALL);
		expect(found.map((i) => i.id)).toEqual(['retail', 'era']);
	});

	it('leaves out the installation on screen', () => {
		const found = index.installationsWith(
			{ providerName: 'Curse', externalId: '1' },
			ALL,
			'retail'
		);
		expect(found.map((i) => i.id)).toEqual(['classic']);
	});

	it('keeps the user’s installation order and lists each one once', () => {
		const found = index.installationsWith(
			{ providerName: 'curse', externalId: '1', installedFolderList: ['DBM-Core'] },
			[ERA, CLASSIC, RETAIL]
		);
		expect(found.map((i) => i.id)).toEqual(['era', 'classic', 'retail']);
	});

	it('returns nothing for an addon installed nowhere, and for installations it does not know', () => {
		expect(index.installationsWith({ providerName: 'Curse', externalId: '99' }, ALL)).toEqual([]);
		expect(index.installationsWith({ providerName: 'Curse', externalId: '2' }, [RETAIL])).toEqual(
			[]
		);
	});

	it('gives the copy installed in a given flavor', () => {
		expect(index.findIn({ installedFolderList: ['DBM-Core'] }, 'era')?.installedFolderList).toEqual(
			['dbm-core', 'DBM-StatusBarTimers']
		);
		expect(index.findIn({ installedFolderList: ['DBM-Core'] }, 'classic')).toBeUndefined();
	});

	describe('missingFrom', () => {
		it('is true when another flavor has the addon and this one does not', () => {
			// Curse 2 is in Era only.
			expect(index.missingFrom({ providerName: 'Curse', externalId: '2' }, ALL, 'retail')).toBe(
				true
			);
		});

		it('is false when this flavor has it, even under another provider', () => {
			// Classic has Curse 1 as Wago w1, with Curse 1 among its alternative ids.
			expect(index.missingFrom({ providerName: 'Curse', externalId: '1' }, ALL, 'classic')).toBe(
				false
			);
		});

		it('is false for an addon installed nowhere', () => {
			expect(index.missingFrom({ providerName: 'Curse', externalId: '99' }, ALL, 'retail')).toBe(
				false
			);
		});

		it('only counts the flavors the user still has', () => {
			// Era has Curse 2, but Era is no longer one of the user's installations.
			expect(
				index.missingFrom({ providerName: 'Curse', externalId: '2' }, [RETAIL, CLASSIC], 'retail')
			).toBe(false);
		});
	});
});
