import { getWowMajorVersion, WowClientType } from 'wowup-lib-core';

/** Clients on the current expansion's game, whatever its version number is this year. */
const RETAIL_FAMILY = new Set([
	WowClientType.Retail,
	WowClientType.RetailPtr,
	WowClientType.RetailXPtr,
	WowClientType.Beta
]);

const parts = (version: string): number[] => version.split('.').map((p) => Number(p) || 0);

function compareVersions(a: string, b: string): number {
	const [pa, pb] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function isClientFlavour(version: string, clientType: WowClientType): boolean {
	// The lib's prefix for Retail is a fixed expansion ("11.") and went stale when Midnight
	// shipped as 12.x. No Classic flavour has ever been above 5, so anything newer is Retail's.
	if (RETAIL_FAMILY.has(clientType)) return parts(version)[0] >= 6;
	// Already a prefix ("5.", "1.1", "1.6"): Forever and Classic Era share major version 1.
	return version.startsWith(getWowMajorVersion(clientType));
}

/**
 * The Game Version column's text: the newest version for the client's flavour when the addon
 * lists one, else the first, followed by "N +" for the other distinct versions.
 */
export function formatGameVersions(versions: string[], clientType?: WowClientType): string {
	const distinct = [...new Set(versions)];
	let display = distinct[0] ?? '';

	if (clientType !== undefined) {
		const newest = distinct
			.filter((v) => isClientFlavour(v, clientType))
			.sort(compareVersions)
			.at(-1);
		if (newest !== undefined) display = newest;
	}

	if (distinct.length > 1) display += `, ${distinct.length - 1} +`;
	return display;
}
