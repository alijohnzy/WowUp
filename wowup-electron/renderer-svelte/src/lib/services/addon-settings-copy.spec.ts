import { describe, expect, it } from 'vitest';
import {
	applySettingsCopy,
	planCopy,
	scanSettings,
	suggestChoices,
	withSettings,
	type WtfReader
} from './addon-settings-copy';

/** A fake file system: every path listed is a file, and its parent folders exist. */
function fakeFs(paths: string[]): WtfReader {
	const children = (dir: string) =>
		paths.filter((p) => p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1).split('/'));
	return {
		listDirectories: async (dir) => [
			...new Set(
				children(dir)
					.filter((parts) => parts.length > 1)
					.map((parts) => parts[0])
			)
		],
		listFiles: async (dir, filter) => {
			const ext = filter.replace('*', '');
			return children(dir)
				.filter((parts) => parts.length === 1 && parts[0].endsWith(ext))
				.map((parts) => parts[0]);
		}
	};
}

const SRC = '/wow/_classic_/WTF';
const DST = '/wow/_retail_/WTF';
const DBM = ['DBM-Core', 'DBM-StatusBarTimers'];

const classic = fakeFs([
	`${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua`,
	`${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua.bak`,
	`${SRC}/Account/ACC1/SavedVariables/Details.lua`,
	`${SRC}/Account/ACC1/Faerlina/Bob/SavedVariables/DBM-StatusBarTimers.lua`,
	`${SRC}/Account/ACC1/Faerlina/Ann/SavedVariables/Details.lua`,
	`${SRC}/Account/ACC1/Whitemane/Cid/SavedVariables/dbm-core.lua`
]);
const retail = fakeFs([
	`${DST}/Account/ACC1/SavedVariables/DBM-Core.lua`,
	`${DST}/Account/ACC1/Faerlina/Bob/SavedVariables/Other.lua`,
	`${DST}/Account/ACC1/Area 52/Zed/SavedVariables/DBM-Core.lua`
]);

describe('scanSettings', () => {
	it('lists every account and character with the addon’s files, ignoring case and .bak', async () => {
		const inv = await scanSettings(classic, DBM, SRC);

		expect(inv.accounts).toEqual([
			{
				key: 'ACC1',
				account: 'ACC1',
				dir: `${SRC}/Account/ACC1`,
				files: ['DBM-Core.lua']
			}
		]);
		expect(inv.characters.map((c) => [c.key, c.files])).toEqual([
			['ACC1/Faerlina/Ann', []],
			['ACC1/Faerlina/Bob', ['DBM-StatusBarTimers.lua']],
			['ACC1/Whitemane/Cid', ['dbm-core.lua']]
		]);
		expect(withSettings(inv.characters).map((c) => c.character)).toEqual(['Bob', 'Cid']);
	});

	it('finds nothing in a WTF folder that does not exist', async () => {
		expect(await scanSettings(fakeFs([]), DBM, SRC)).toEqual({ accounts: [], characters: [] });
	});
});

describe('suggestChoices', () => {
	it('matches accounts by name and characters by realm and name, case-insensitively', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(
			fakeFs([
				`${DST}/Account/acc1/SavedVariables/x.lua`,
				`${DST}/Account/acc1/faerlina/BOB/SavedVariables/x.lua`,
				`${DST}/Account/acc1/Faerlina/Ann/SavedVariables/x.lua`
			]),
			DBM,
			DST
		);

		// Ann has no settings for the addon in the source, so she keeps her own.
		expect(suggestChoices(source, target)).toEqual({
			acc1: 'ACC1',
			'acc1/faerlina/BOB': 'ACC1/Faerlina/Bob'
		});
	});

	it('pairs the only account on each side even when the names differ', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(
			fakeFs([`${DST}/Account/OTHER/SavedVariables/x.lua`]),
			DBM,
			DST
		);
		expect(suggestChoices(source, target)).toEqual({ OTHER: 'ACC1' });
	});

	it('suggests nothing for an account when it is ambiguous', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(
			fakeFs([`${DST}/Account/A/SavedVariables/x.lua`, `${DST}/Account/B/SavedVariables/x.lua`]),
			DBM,
			DST
		);
		expect(suggestChoices(source, target)).toEqual({});
	});
});

describe('planCopy', () => {
	it('copies what each target was matched to, keeping the target’s file names', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(retail, DBM, DST);

		const plan = planCopy(source, target, {
			ACC1: 'ACC1',
			// one source character to several targets
			'ACC1/Faerlina/Bob': 'ACC1/Whitemane/Cid',
			'ACC1/Area 52/Zed': 'ACC1/Whitemane/Cid'
		});

		expect(plan.files).toEqual([
			{
				from: `${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua`,
				to: `${DST}/Account/ACC1/SavedVariables/DBM-Core.lua`,
				replaces: true
			},
			{
				from: `${SRC}/Account/ACC1/Whitemane/Cid/SavedVariables/dbm-core.lua`,
				to: `${DST}/Account/ACC1/Area 52/Zed/SavedVariables/DBM-Core.lua`,
				replaces: true
			},
			{
				from: `${SRC}/Account/ACC1/Whitemane/Cid/SavedVariables/dbm-core.lua`,
				to: `${DST}/Account/ACC1/Faerlina/Bob/SavedVariables/dbm-core.lua`,
				replaces: false
			}
		]);
	});

	it('ignores choices that pair an account with a character, or name nothing real', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(retail, DBM, DST);

		const plan = planCopy(source, target, {
			ACC1: 'ACC1/Faerlina/Bob',
			'ACC1/Faerlina/Bob': 'ACC1',
			'ACC1/Area 52/Zed': 'nobody'
		});

		expect(plan.files).toEqual([]);
	});

	it('copies nothing from a source with no settings for the addon', async () => {
		const source = await scanSettings(classic, DBM, SRC);
		const target = await scanSettings(retail, DBM, DST);
		expect(planCopy(source, target, { 'ACC1/Faerlina/Bob': 'ACC1/Faerlina/Ann' }).files).toEqual(
			[]
		);
	});
});

describe('applySettingsCopy', () => {
	it('creates each target folder once, then copies', async () => {
		const calls: string[] = [];
		await applySettingsCopy(
			{
				createDirectory: async (d) => calls.push(`mkdir ${d}`),
				copy: async (from, to) => calls.push(`cp ${from} ${to}`)
			},
			{
				files: [
					{ from: '/a/SavedVariables/X.lua', to: '/b/SavedVariables/X.lua', replaces: false },
					{ from: '/a/SavedVariables/Y.lua', to: '/b/SavedVariables/Y.lua', replaces: true }
				]
			}
		);
		expect(calls).toEqual([
			'mkdir /b/SavedVariables',
			'cp /a/SavedVariables/X.lua /b/SavedVariables/X.lua',
			'cp /a/SavedVariables/Y.lua /b/SavedVariables/Y.lua'
		]);
	});
});
