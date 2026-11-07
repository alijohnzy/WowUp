// Copying an addon's settings from one WoW installation (flavor) to another.
//
// WoW saves an addon's settings as Lua files named after the addon's folder:
//   WTF/Account/<ACCOUNT>/SavedVariables/<Folder>.lua                         account-wide
//   WTF/Account/<ACCOUNT>/<Realm>/<Character>/SavedVariables/<Folder>.lua     per character
// Each flavor has its own WTF folder. Copying means taking those files from the source flavor
// and putting them in the same place in the target.
//
// Only places that already exist in the target are written: an account (or a character) the
// player has never logged in with in the target flavor has no folder there, and inventing one
// would leave settings nobody can use. Those accounts are reported so the dialog can say so.
// `.lua.bak` files are left alone; WoW writes its own when it next saves.

import * as path from '$lib/utils/path';

const ACCOUNT_FOLDER = 'Account';
const SAVED_VARIABLES = 'SavedVariables';

export interface SettingsFile {
	from: string;
	to: string;
	/** The target already has settings in this file, which the copy replaces. */
	replaces: boolean;
}

export interface SettingsCopyPlan {
	files: SettingsFile[];
	/** Accounts with settings in the source that the target has never been used with. */
	skippedAccounts: string[];
}

/** The file reads the plan needs. Both return [] for a folder that does not exist. */
export interface WtfReader {
	listDirectories(dir: string): Promise<string[]>;
	listFiles(dir: string, filter: string): Promise<string[]>;
}

export interface WtfWriter {
	createDirectory(dir: string): Promise<unknown>;
	copy(from: string, to: string): Promise<unknown>;
}

/** Folder names in `dir`, with SavedVariables (a sibling of realms and accounts) left out. */
async function subfolders(fs: WtfReader, dir: string): Promise<string[]> {
	return (await fs.listDirectories(dir)).filter((d) => d !== SAVED_VARIABLES);
}

/**
 * Pairs names present in both lists. Exact matches first, then ignoring case: WoW writes these
 * names itself, but a Windows install copied to Linux can differ only in case.
 */
function pairNames(source: string[], target: string[]): [string, string][] {
	const exact = new Set(target);
	const lower = new Map(target.map((t) => [t.toLowerCase(), t]));
	return source.flatMap((s): [string, string][] => {
		if (exact.has(s)) return [[s, s]];
		const t = lower.get(s.toLowerCase());
		return t ? [[s, t]] : [];
	});
}

async function luaFiles(fs: WtfReader, dir: string): Promise<Map<string, string>> {
	const files = await fs.listFiles(dir, '*.lua');
	return new Map(files.map((f) => [f.toLowerCase(), f]));
}

async function planSavedVariables(
	fs: WtfReader,
	folders: string[],
	sourceDir: string,
	targetDir: string
): Promise<SettingsFile[]> {
	const sourceFiles = await luaFiles(fs, path.join(sourceDir, SAVED_VARIABLES));
	if (sourceFiles.size === 0) return [];
	const targetFiles = await luaFiles(fs, path.join(targetDir, SAVED_VARIABLES));

	return folders.flatMap((folder): SettingsFile[] => {
		const wanted = `${folder}.lua`.toLowerCase();
		const name = sourceFiles.get(wanted);
		if (!name) return [];
		const existing = targetFiles.get(wanted);
		return [
			{
				from: path.join(sourceDir, SAVED_VARIABLES, name),
				to: path.join(targetDir, SAVED_VARIABLES, existing ?? name),
				replaces: existing !== undefined
			}
		];
	});
}

/**
 * Works out which settings files to copy for an addon made of `folders`, from the WTF folder
 * `sourceWtf` to `targetWtf`. Reads only; nothing is written.
 */
export async function planSettingsCopy(
	fs: WtfReader,
	folders: string[],
	sourceWtf: string,
	targetWtf: string
): Promise<SettingsCopyPlan> {
	const uniqueFolders = [...new Map(folders.map((f) => [f.toLowerCase(), f])).values()];
	const sourceAccounts = path.join(sourceWtf, ACCOUNT_FOLDER);
	const targetAccounts = path.join(targetWtf, ACCOUNT_FOLDER);

	const files: SettingsFile[] = [];
	const skippedAccounts: string[] = [];
	const targetAccountNames = await subfolders(fs, targetAccounts);

	for (const account of await subfolders(fs, sourceAccounts)) {
		const sourceAccount = path.join(sourceAccounts, account);
		const [pair] = pairNames([account], targetAccountNames);
		if (!pair) {
			// Only worth mentioning if this account has settings for the addon to lose out on.
			const accountFiles = await planSavedVariables(
				fs,
				uniqueFolders,
				sourceAccount,
				sourceAccount
			);
			if (accountFiles.length > 0) skippedAccounts.push(account);
			continue;
		}
		const targetAccount = path.join(targetAccounts, pair[1]);
		files.push(...(await planSavedVariables(fs, uniqueFolders, sourceAccount, targetAccount)));

		const realms = pairNames(
			await subfolders(fs, sourceAccount),
			await subfolders(fs, targetAccount)
		);
		for (const [sourceRealm, targetRealm] of realms) {
			const characters = pairNames(
				await fs.listDirectories(path.join(sourceAccount, sourceRealm)),
				await fs.listDirectories(path.join(targetAccount, targetRealm))
			);
			for (const [sourceChar, targetChar] of characters) {
				files.push(
					...(await planSavedVariables(
						fs,
						uniqueFolders,
						path.join(sourceAccount, sourceRealm, sourceChar),
						path.join(targetAccount, targetRealm, targetChar)
					))
				);
			}
		}
	}

	return { files, skippedAccounts };
}

/** Copies the planned files, creating a SavedVariables folder where the target lacks one. */
export async function applySettingsCopy(fs: WtfWriter, plan: SettingsCopyPlan): Promise<void> {
	const dirs = new Set(plan.files.map((f) => path.dirname(f.to)));
	for (const dir of dirs) await fs.createDirectory(dir);
	for (const file of plan.files) await fs.copy(file.from, file.to);
}
