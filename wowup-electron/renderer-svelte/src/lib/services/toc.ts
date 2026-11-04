// Port of src/app/services/toc/toc.service.ts (164 LOC).
//
// Removed: @Injectable + FileService DI, Node `path` (-> $lib/utils/path),
// lodash `uniq` (-> [...new Set()]).
// Kept: wowup-lib-core's TOC key constants and getTocForGameType — framework-agnostic.

import * as tocModels from 'wowup-lib-core';
import {
	getTocForClientType,
	getTocForGameType,
	hasLoadGameTypeConditions,
	isLoadConditionMet,
	stripLoadConditions,
	WowGameType,
	type Toc,
	type WowClientType
} from 'wowup-lib-core';
import { listFiles, readFile } from './files';
import { basename, join } from '$lib/utils/path';

/** Strip WoW colour escape codes: |cAARRGGBB … |r */
export function stripColorCode(str: string): string {
	if (str.indexOf('|c') === -1) return str;
	return str.replace(/(\|c[a-z0-9]{8})|(\|r)/gi, '').trim();
}

/** Strip WoW inline texture codes: |T…|t */
export function stripTextureCode(str: string): string {
	if (str.indexOf('|T') === -1) return str;
	return str.replace(/(\|T.*\|t)/g, '').trim();
}

const stripNewLineChars = (value: string): string => value.replace(/\|r/g, '');

// Load directives first: "Title [AllowLoadGameType wrath]" is "Title" whatever the client.
const stripEncodedChars = (value: string): string =>
	stripNewLineChars(stripTextureCode(stripColorCode(stripLoadConditions(value))));

function getValue(key: string, tocText: string): string {
	const match = new RegExp(`^## ${key}:(.*?)$`, 'm').exec(tocText);
	if (!match || match.length !== 2) return '';
	return stripEncodedChars(match[1].trim());
}

function getValueArray(key: string, tocText: string): string[] {
	// lodash uniq -> Set
	return [
		...new Set(
			getValue(key, tocText)
				.split(',')
				.map((x) => x.trim())
		)
	];
}

const TITLE_LINE = /^##\s*Title\s*:/i;

/**
 * A TOC can carry several titles guarded by [AllowLoadGameType …] conditions; the game shows
 * the last one that applies to it. Only set when such conditions are present, so a plain TOC
 * keeps using `title`. Port of upstream's TocService.getTitlesByGameType (c2f130f3).
 */
function getTitlesByGameType(tocText: string): Record<string, string> | undefined {
	const titleLines = tocText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => TITLE_LINE.test(line));

	if (!titleLines.some((line) => hasLoadGameTypeConditions(line))) return undefined;

	const titles: Record<string, string> = {};
	for (const gameType of Object.values(WowGameType)) {
		const line = titleLines.findLast((titleLine) => isLoadConditionMet(titleLine, gameType));
		const title = line ? stripEncodedChars(line.replace(TITLE_LINE, '').trim()) : '';
		if (title) titles[gameType] = title;
	}
	return titles;
}

const getWebsite = (tocText: string): string =>
	getValue(tocModels.TOC_WEBSITE, tocText) || getValue(tocModels.TOC_X_WEBSITE, tocText);

function getDependencyList(tocText: string): string[] {
	const dependencies = getValue(tocModels.TOC_DEPENDENCIES, tocText);
	const requiredDeps = getValue(tocModels.TOC_REQUIRED_DEPS, tocText);
	return [...dependencies.split(','), ...requiredDeps.split(',')].filter((dep) => !!dep);
}

export async function parse(tocPath: string): Promise<Toc> {
	const fileName = basename(tocPath);
	const tocText = (await readFile(tocPath)).trim();

	return {
		fileName,
		filePath: tocPath,
		author: getValue(tocModels.TOC_AUTHOR, tocText),
		curseProjectId: getValue(tocModels.TOC_X_CURSE_PROJECT_ID, tocText),
		interface: getValueArray(tocModels.TOC_INTERFACE, tocText),
		title: getValue(tocModels.TOC_TITLE, tocText),
		titles: getTitlesByGameType(tocText),
		website: getWebsite(tocText),
		version: getValue(tocModels.TOC_VERSION, tocText),
		partOf: getValue(tocModels.TOC_X_PART_OF, tocText),
		category: getValue(tocModels.TOC_X_CATEGORY, tocText),
		localizations: getValue(tocModels.TOC_X_LOCALIZATIONS, tocText),
		wowInterfaceId: getValue(tocModels.TOC_X_WOWI_ID, tocText),
		wagoAddonId: getValue(tocModels.TOC_X_WAGO_ID, tocText),
		dependencies:
			getValue(tocModels.TOC_DEPENDENCIES, tocText) ||
			getValue(tocModels.TOC_REQUIRED_DEPS, tocText),
		dependencyList: getDependencyList(tocText),
		tukUiProjectId: getValue(tocModels.TOC_X_TUKUI_PROJECTID, tocText),
		tukUiProjectFolders: getValue(tocModels.TOC_X_TUKUI_PROJECTFOLDERS, tocText),
		loadOnDemand: getValue(tocModels.TOC_X_LOADONDEMAND, tocText),
		addonProvider: getValue(tocModels.TOC_X_ADDON_PROVIDER, tocText),
		notes: getValue(tocModels.TOC_NOTES, tocText)
	};
}

const removeExtension = (fileName: string): string => fileName.replace(/\.[^/.]+$/, '');

export function getTocForGameType2(
	folderName: string,
	tocs: Toc[],
	clientType: WowClientType
): Toc | undefined {
	const matchedToc = getTocForGameType(
		tocs.map((toc) => toc.fileName),
		clientType
	);

	// No game-type match: fall back to the toc named after its folder.
	// Example: "All The Things" for TBC (ATT-Classic).
	if (matchedToc === '') {
		return titled(
			tocs.find((toc) => removeExtension(toc.fileName).toLowerCase() === folderName.toLowerCase()),
			clientType
		);
	}

	return titled(
		tocs.find((toc) => toc.fileName === matchedToc),
		clientType
	);
}

/** The toc as the client sees it: titled for its game type. */
const titled = (toc: Toc | undefined, clientType: WowClientType): Toc | undefined =>
	toc && getTocForClientType(toc, clientType);

/** All valid tocs under baseDir for the given installed folders and client type. */
export async function getAllTocs(
	baseDir: string,
	installedFolders: string[],
	clientType: WowClientType
): Promise<Toc[]> {
	const tocs: Toc[] = [];

	for (const dir of installedFolders) {
		const dirPath = join(baseDir, dir);
		const tocFiles = await listFiles(dirPath, '*.toc');
		const allTocs = await Promise.all(tocFiles.map((tf) => parse(join(dirPath, tf))));

		const tf = getTocForGameType2(dir, allTocs, clientType);
		if (tf !== undefined) tocs.push(tf);
	}

	return tocs;
}

export async function parseMetaData(tocPath: string): Promise<string[]> {
	const tocText = await readFile(tocPath);
	return tocText.split('\n').filter((line) => line.trim().startsWith('## '));
}
