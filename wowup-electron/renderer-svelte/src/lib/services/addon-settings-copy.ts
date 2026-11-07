// Copying an addon's settings from one WoW installation (flavor) to another.
//
// WoW saves an addon's settings as Lua files named after the addon's folder:
//   WTF/Account/<ACCOUNT>/SavedVariables/<Folder>.lua                         account-wide
//   WTF/Account/<ACCOUNT>/<Realm>/<Character>/SavedVariables/<Folder>.lua     per character
// Each flavor has its own WTF folder, and its own characters: a Classic character rarely
// exists in Retail under the same realm and name. So copying is a matching job — for each
// account and character in the target, which account or character of the source (if any)
// should its settings come from. This module finds what exists on both sides, suggests the
// obvious matches, and turns the user's choices into a list of files to copy.
//
// Only places that already exist in the target are offered: an account or character the
// player never logged in with in the target flavor has no folder there. `.lua.bak` files are
// left alone; WoW writes its own when it next saves.

import * as path from '$lib/utils/path';

const ACCOUNT_FOLDER = 'Account';
const SAVED_VARIABLES = 'SavedVariables';

/** An account or a character: somewhere WoW keeps a SavedVariables folder. */
export interface SettingsScope {
	/** Unique within one WTF folder: "ACCOUNT" or "ACCOUNT/Realm/Character". */
	key: string;
	account: string;
	realm?: string;
	character?: string;
	/** The folder that holds this scope's SavedVariables folder. */
	dir: string;
	/** The addon's settings files found here, named as on disk. Empty if it has none yet. */
	files: string[];
}

export interface SettingsInventory {
	accounts: SettingsScope[];
	characters: SettingsScope[];
}

/** Target scope key → the source scope key whose settings it gets. Absent: keep its own. */
export type SettingsChoices = Record<string, string>;

export interface SettingsFile {
	from: string;
	to: string;
	/** The target already has settings in this file, which the copy replaces. */
	replaces: boolean;
}

export interface SettingsCopyPlan {
	files: SettingsFile[];
}

/** The file reads a scan needs. Both return [] for a folder that does not exist. */
export interface WtfReader {
	listDirectories(dir: string): Promise<string[]>;
	listFiles(dir: string, filter: string): Promise<string[]>;
}

export interface WtfWriter {
	createDirectory(dir: string): Promise<unknown>;
	copy(from: string, to: string): Promise<unknown>;
}

const same = (a: string | undefined, b: string | undefined) =>
	(a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Folder names in `dir`, without the SavedVariables folder that sits beside realms. */
async function subfolders(fs: WtfReader, dir: string): Promise<string[]> {
	return (await fs.listDirectories(dir)).filter((d) => d !== SAVED_VARIABLES);
}

/** The addon's settings files in `dir`/SavedVariables, matched to `folders` ignoring case. */
async function settingsFiles(fs: WtfReader, folders: Set<string>, dir: string): Promise<string[]> {
	const files = await fs.listFiles(path.join(dir, SAVED_VARIABLES), '*.lua');
	return files.filter((f) => folders.has(f.toLowerCase().replace(/\.lua$/, '')));
}

/**
 * Every account and character in the WTF folder `wtfPath`, each with the settings files it
 * has for an addon made of `folders`. Reads only.
 */
export async function scanSettings(
	fs: WtfReader,
	folders: string[],
	wtfPath: string
): Promise<SettingsInventory> {
	const wanted = new Set(folders.map((f) => f.toLowerCase()));
	const accountsDir = path.join(wtfPath, ACCOUNT_FOLDER);
	const accounts: SettingsScope[] = [];
	const characters: SettingsScope[] = [];

	for (const account of await subfolders(fs, accountsDir)) {
		const accountDir = path.join(accountsDir, account);
		accounts.push({
			key: account,
			account,
			dir: accountDir,
			files: await settingsFiles(fs, wanted, accountDir)
		});

		for (const realm of await subfolders(fs, accountDir)) {
			const realmDir = path.join(accountDir, realm);
			const found = await Promise.all(
				(await fs.listDirectories(realmDir)).map(async (character) => {
					const dir = path.join(realmDir, character);
					return {
						key: `${account}/${realm}/${character}`,
						account,
						realm,
						character,
						dir,
						files: await settingsFiles(fs, wanted, dir)
					};
				})
			);
			characters.push(...found);
		}
	}

	const byName = (a: SettingsScope, b: SettingsScope) =>
		(a.realm ?? '').localeCompare(b.realm ?? '') ||
		(a.character ?? '').localeCompare(b.character ?? '') ||
		a.account.localeCompare(b.account);
	characters.sort(byName);
	return { accounts, characters };
}

/** The scopes that have settings to copy. */
export const withSettings = (scopes: SettingsScope[]) => scopes.filter((s) => s.files.length > 0);

/**
 * The obvious matches: an account to the source account of the same name, a character to the
 * source character of the same realm and name. When each side has exactly one account, those
 * two are matched whatever their names. Everything else keeps its own settings.
 */
export function suggestChoices(
	source: SettingsInventory,
	target: SettingsInventory
): SettingsChoices {
	const choices: SettingsChoices = {};
	const sourceAccounts = withSettings(source.accounts);

	for (const t of target.accounts) {
		const match =
			sourceAccounts.find((s) => same(s.account, t.account)) ??
			(sourceAccounts.length === 1 && target.accounts.length === 1 ? sourceAccounts[0] : undefined);
		if (match) choices[t.key] = match.key;
	}

	const sourceCharacters = withSettings(source.characters);
	for (const t of target.characters) {
		const matches = sourceCharacters.filter(
			(s) => same(s.realm, t.realm) && same(s.character, t.character)
		);
		const match = matches.find((s) => same(s.account, t.account)) ?? matches[0];
		if (match) choices[t.key] = match.key;
	}
	return choices;
}

/**
 * The files to copy for `choices`. A choice only pairs like with like — account with account,
 * character with character — and only a source that has settings.
 */
export function planCopy(
	source: SettingsInventory,
	target: SettingsInventory,
	choices: SettingsChoices
): SettingsCopyPlan {
	const sources = new Map([...source.accounts, ...source.characters].map((s) => [s.key, s]));

	const files = [...target.accounts, ...target.characters].flatMap((t): SettingsFile[] => {
		const s = sources.get(choices[t.key]);
		if (!s || !s.character !== !t.character) return [];
		return s.files.map((name) => {
			const existing = t.files.find((f) => same(f, name));
			return {
				from: path.join(s.dir, SAVED_VARIABLES, name),
				to: path.join(t.dir, SAVED_VARIABLES, existing ?? name),
				replaces: existing !== undefined
			};
		});
	});
	return { files };
}

/** Copies the planned files, creating a SavedVariables folder where the target lacks one. */
export async function applySettingsCopy(fs: WtfWriter, plan: SettingsCopyPlan): Promise<void> {
	const dirs = new Set(plan.files.map((f) => path.dirname(f.to)));
	for (const dir of dirs) await fs.createDirectory(dir);
	for (const file of plan.files) await fs.copy(file.from, file.to);
}
