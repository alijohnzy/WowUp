// Ports of the Angular pipes that survive: src/app/pipes/{download-count, interface-format,
// size-display, relative-duration, ngx-date, get-addon-list-item-file-prop}.pipe.ts.
//
// Svelte has no pipe concept — templates call functions — so all six become one module and
// the @Pipe/@Injectable wrappers disappear. Three of the twelve Angular pipes needed no
// port at all: `trust-html` becomes {@html}, `inverse-bool` becomes `!x`, and `ngx-date`
// was already just `toLocaleString`.
//
// Beyond the boilerplate, Angular pipes are impure by default: each one re-ran on every
// change-detection cycle for every cell that used it.

import { getGameVersion, type AddonChannelType, type AddonSearchResult } from 'wowup-lib-core';
import { i18n } from '$lib/i18n.svelte';
import { formatSize, shortenDownloadCount } from '$lib/utils/misc';
import { getLatestFile } from '$lib/utils/search-result';

export { formatSize };

/** Locale-aware "1.2k downloads" style formatting. */
export function downloadCount(value: number): string {
	const numMatches = /(e\+\d+)/.exec(value.toExponential());
	if (!numMatches) return value.toString();

	const suffix = numMatches[1];
	return i18n.t(`COMMON.DOWNLOAD_COUNT.${suffix}`, {
		rawCount: value,
		count: shortenDownloadCount(value, 3),
		simpleCount: shortenDownloadCount(value, 1),
		myriadCount: shortenDownloadCount(value, 4)
	});
}

/** WoW interface number (100002) -> semver-ish display (10.0.2). */
export const interfaceFormat = (value: string): string => getGameVersion(value);

/** Locale-aware date, matching the old ngx-date pipe. */
export const localeDate = (value: string | number | Date): string =>
	new Date(value).toLocaleString(i18n.locale);

/** Read a property off a search result's latest file for the given channel. */
export function addonFileProp(
	searchResult: AddonSearchResult | undefined,
	prop: string,
	channel: AddonChannelType
): unknown {
	const file = getLatestFile(searchResult, channel);
	return file && Object.prototype.hasOwnProperty.call(file, prop)
		? (file as unknown as Record<string, unknown>)[prop]
		: '';
}
