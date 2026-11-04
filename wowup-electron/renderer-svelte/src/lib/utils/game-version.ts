import { getWowMajorVersion, type WowClientType } from 'wowup-lib-core';

/**
 * The Game Version column's text: the version matching the client's flavor when the addon lists
 * one, else the first, followed by "N +" for the rest.
 */
export function formatGameVersions(versions: string[], clientType?: WowClientType): string {
	let display = versions[0] ?? '';

	if (clientType !== undefined) {
		const majorVersion = getWowMajorVersion(clientType);
		// Already a prefix ("11.", "1.1", "1.6"): Forever and Classic Era share major version 1.
		const match = versions.find((v) => v.startsWith(majorVersion));
		if (match !== undefined) display = match;
	}

	if (versions.length - 1 > 0) display += `, ${versions.length - 1} +`;
	return display;
}
