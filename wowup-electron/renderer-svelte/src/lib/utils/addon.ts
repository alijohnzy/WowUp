// Port of src/app/utils/addon.utils.ts (98 LOC).
// lodash orderBy/filter -> native sort/filter.

import type { Addon, AddonDependency, AddonDependencyType, AddonExternalId } from 'wowup-lib-core';

export function getAllProviders(addon: Addon): AddonExternalId[] {
	return [...(addon.externalIds ?? [])].sort((a, b) =>
		a.providerName.localeCompare(b.providerName)
	);
}

export const getProviders = (addon: Addon): AddonExternalId[] =>
	getAllProviders(addon).filter((extId) => extId.providerName !== addon.providerName);

export const hasMultipleProviders = (addon: Addon): boolean => getProviders(addon).length > 0;

export function getAddonDependencies(
	addon: Addon,
	dependencyType: AddonDependencyType | undefined = undefined
): AddonDependency[] {
	if (dependencyType === undefined) return addon.dependencies ?? [];
	return (addon.dependencies ?? []).filter((dep) => dep.type === dependencyType);
}

export function needsUpdate(addon: Addon | undefined): boolean {
	if (addon === undefined || addon.isIgnored) return false;

	// Authors sometimes push a new build without changing the toc version.
	if (
		addon.externalLatestReleaseId &&
		addon.externalLatestReleaseId !== addon.installedExternalReleaseId
	) {
		return true;
	}

	const installedVer = (addon?.installedVersion ?? '').replace(/^v/i, '');
	const latestVer = (addon?.latestVersion ?? '').replace(/^v/i, '');

	return installedVer.length > 0 && installedVer !== latestVer;
}

export const needsInstall = (addon: Addon): boolean => !addon.installedVersion;

function padInterfacePart(part: string, idx: number): string | number {
	const num = parseInt(part, 10);
	if (idx === 0) return num;
	return num >= 10 ? num : `0${num}`;
}

/**
 * Format a semver (10.0.0) as a WoW interface version (100000).
 * Throws when the version is empty or undefined.
 */
export function toInterfaceVersion(version: string): string {
	if (!version) throw new Error('interface version empty or undefined');
	if (version.indexOf('.') === -1) return version;

	const parts = version.split('.');
	if (parts.length !== 3) {
		console.warn(`invalid part length: ${parts.length} - ${version}`);
		while (parts.length < 3) parts.push('0');
		console.warn(`guessing version: ${parts.join('.')}`);
	}

	return parts.map((part, idx) => padInterfacePart(part, idx)).join('');
}
