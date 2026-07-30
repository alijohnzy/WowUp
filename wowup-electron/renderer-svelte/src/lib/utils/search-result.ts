// Port of src/app/utils/search-result.utils.ts (48 LOC).
// lodash filter/orderBy/first -> native.

import type {
	AddonChannelType,
	AddonDependencyType,
	AddonSearchResult,
	AddonSearchResultDependency,
	AddonSearchResultFile
} from 'wowup-lib-core';

const byReleaseDateDesc = (a: AddonSearchResultFile, b: AddonSearchResultFile): number =>
	new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime();

export function getLatestFile(
	searchResult: AddonSearchResult | undefined,
	channel: AddonChannelType
): AddonSearchResultFile | undefined {
	if (!searchResult?.files) {
		console.warn(
			`Search result had no files: [${searchResult?.providerName ?? ''}:${
				searchResult?.externalId ?? ''
			}] ${searchResult?.name ?? ''}`
		);
		return undefined;
	}

	const inChannel = searchResult.files
		.filter((f) => f.channelType <= channel)
		.sort(byReleaseDateDesc);

	// No file matches the requested channel — fall back to the newest of any channel.
	return inChannel[0] ?? [...searchResult.files].sort(byReleaseDateDesc)[0];
}

export const getDependencies = (
	searchResult: AddonSearchResult,
	channel: AddonChannelType
): AddonSearchResultDependency[] => getLatestFile(searchResult, channel)?.dependencies || [];

export const getDependencyType = (
	searchResult: AddonSearchResult,
	channel: AddonChannelType,
	dependencyType: AddonDependencyType
): AddonSearchResultDependency[] =>
	getDependencies(searchResult, channel).filter((dep) => dep.type === dependencyType);
