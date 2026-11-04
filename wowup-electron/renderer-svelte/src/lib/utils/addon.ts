// Port of src/app/utils/addon.utils.ts (98 LOC).
// lodash orderBy/filter -> native sort/filter.

import type { Addon, AddonDependency, AddonDependencyType, AddonExternalId } from 'wowup-lib-core';

/** Whether an external id's provider can be switched to in this build. */
export type ProviderAvailability = (providerName: string) => boolean;

/**
 * Every provider the addon can be switched to, plus its own. Ids for providers this build does
 * not register or the user turned off are left out: they are recorded from TOC metadata
 * regardless, and picking one could only fail.
 */
export function getAllProviders(
	addon: Addon,
	isAvailable: ProviderAvailability = () => true
): AddonExternalId[] {
	return (addon.externalIds ?? [])
		.filter((ext) => ext.providerName === addon.providerName || isAvailable(ext.providerName))
		.sort((a, b) => a.providerName.localeCompare(b.providerName));
}

export const getProviders = (addon: Addon, isAvailable?: ProviderAvailability): AddonExternalId[] =>
	getAllProviders(addon, isAvailable).filter((extId) => extId.providerName !== addon.providerName);

export const hasMultipleProviders = (addon: Addon, isAvailable?: ProviderAvailability): boolean =>
	getProviders(addon, isAvailable).length > 0;

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

/**
 * The game versions to store for an addon from the release on offer. Providers that list every
 * patch a release targets (CurseForge) set `gameVersions`; the rest only `gameVersion`.
 */
export function getFileTargetVersions(file: {
	gameVersion?: string;
	gameVersions?: string[];
}): string[] {
	const versions = file.gameVersions?.length ? file.gameVersions : [file.gameVersion ?? ''];
	return [...new Set(versions.filter((v) => v.length > 0))];
}
