import { describe, expect, it } from 'vitest';
import { applySettingsCopy, planSettingsCopy, type WtfReader } from './addon-settings-copy';

/** A fake file system: every path listed is a file, and its parent folders exist. */
function fakeFs(paths: string[]): WtfReader & { copies: string[][]; dirs: string[] } {
	const files = new Set(paths);
	const children = (dir: string) =>
		[...files]
			.filter((p) => p.startsWith(dir + '/'))
			.map((p) => p.slice(dir.length + 1).split('/'));
	return {
		copies: [],
		dirs: [],
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

describe('planSettingsCopy', () => {
	it('copies account-wide settings for each of the addon’s folders', async () => {
		const fs = fakeFs([
			`${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua`,
			`${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua.bak`,
			`${SRC}/Account/ACC1/SavedVariables/DBM-StatusBarTimers.lua`,
			`${SRC}/Account/ACC1/SavedVariables/Details.lua`,
			`${DST}/Account/ACC1/SavedVariables/DBM-Core.lua`
		]);

		const plan = await planSettingsCopy(fs, ['DBM-Core', 'DBM-StatusBarTimers'], SRC, DST);

		expect(plan.files).toEqual([
			{
				from: `${SRC}/Account/ACC1/SavedVariables/DBM-Core.lua`,
				to: `${DST}/Account/ACC1/SavedVariables/DBM-Core.lua`,
				replaces: true
			},
			{
				from: `${SRC}/Account/ACC1/SavedVariables/DBM-StatusBarTimers.lua`,
				to: `${DST}/Account/ACC1/SavedVariables/DBM-StatusBarTimers.lua`,
				replaces: false
			}
		]);
		expect(plan.skippedAccounts).toEqual([]);
	});

	it('copies per-character settings only for characters that exist in both', async () => {
		const fs = fakeFs([
			`${SRC}/Account/ACC1/SavedVariables/Other.lua`,
			`${SRC}/Account/ACC1/Faerlina/Bob/SavedVariables/Questie.lua`,
			`${SRC}/Account/ACC1/Faerlina/Ann/SavedVariables/Questie.lua`,
			`${DST}/Account/ACC1/SavedVariables/Other.lua`,
			`${DST}/Account/ACC1/Faerlina/Bob/layout-local.txt`
		]);

		const plan = await planSettingsCopy(fs, ['Questie'], SRC, DST);

		expect(plan.files.map((f) => f.to)).toEqual([
			`${DST}/Account/ACC1/Faerlina/Bob/SavedVariables/Questie.lua`
		]);
	});

	it('skips, and reports, an account never used in the target', async () => {
		const fs = fakeFs([
			`${SRC}/Account/ACC1/SavedVariables/ElvUI.lua`,
			`${SRC}/Account/ACC2/SavedVariables/ElvUI.lua`,
			`${SRC}/Account/ACC3/SavedVariables/Other.lua`,
			`${DST}/Account/ACC1/SavedVariables/Other.lua`
		]);

		const plan = await planSettingsCopy(fs, ['ElvUI'], SRC, DST);

		expect(plan.files.map((f) => f.to)).toEqual([`${DST}/Account/ACC1/SavedVariables/ElvUI.lua`]);
		expect(plan.skippedAccounts).toEqual(['ACC2']);
	});

	it('matches names that differ only in case, and keeps the target’s spelling', async () => {
		const fs = fakeFs([
			`${SRC}/Account/acc1/SavedVariables/elvui.lua`,
			`${DST}/Account/ACC1/SavedVariables/ElvUI.lua`
		]);

		const plan = await planSettingsCopy(fs, ['ElvUI', 'elvui'], SRC, DST);

		expect(plan.files).toEqual([
			{
				from: `${SRC}/Account/acc1/SavedVariables/elvui.lua`,
				to: `${DST}/Account/ACC1/SavedVariables/ElvUI.lua`,
				replaces: true
			}
		]);
	});

	it('plans nothing when the source has no settings for the addon', async () => {
		const fs = fakeFs([
			`${SRC}/Account/ACC1/SavedVariables/Other.lua`,
			`${DST}/Account/ACC1/SavedVariables/Other.lua`
		]);
		expect(await planSettingsCopy(fs, ['ElvUI'], SRC, DST)).toEqual({
			files: [],
			skippedAccounts: []
		});
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
				],
				skippedAccounts: []
			}
		);
		expect(calls).toEqual([
			'mkdir /b/SavedVariables',
			'cp /a/SavedVariables/X.lua /b/SavedVariables/X.lua',
			'cp /a/SavedVariables/Y.lua /b/SavedVariables/Y.lua'
		]);
	});
});
