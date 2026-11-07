// Which of the user's WoW installations ("flavors": Retail, Classic Era, ...) have a given
// addon. Used by Get Addons to say where a search result is already installed, and by My Addons
// to offer the flavors whose settings can be copied.
//
// An addon is the same one in two flavors when any of these match:
// - provider and id (the common case: installed from the same provider in both);
// - one of the alternative provider ids WowUp records for an addon (`externalIds`), so an addon
//   installed from CurseForge in Retail and from Wago in Classic still counts;
// - an addon folder name. Settings are saved per folder (WTF/.../SavedVariables/<Folder>.lua),
//   so this is also the match that matters when copying them. Search results have no folders.

import type { Addon, AddonExternalId, WowInstallation } from 'wowup-lib-core';

export interface AddonIdentity {
	providerName?: string;
	externalId?: string;
	externalIds?: AddonExternalId[];
	installedFolderList?: string[];
}

const idKey = (providerName: string, id: string) => `id:${providerName.toLowerCase()}|${id}`;
const folderKey = (folder: string) => `folder:${folder.toLowerCase()}`;

/** Every key an addon can be matched by. */
export function identityKeys(addon: AddonIdentity): string[] {
	const keys = new Set<string>();
	if (addon.providerName && addon.externalId) keys.add(idKey(addon.providerName, addon.externalId));
	for (const ext of addon.externalIds ?? []) {
		if (ext?.providerName && ext.id) keys.add(idKey(ext.providerName, ext.id));
	}
	for (const folder of addon.installedFolderList ?? []) {
		if (folder) keys.add(folderKey(folder));
	}
	return [...keys];
}

/** Installed addons by match key, each with the installations it appears in. */
export class AddonFlavorIndex {
	readonly #byKey = new Map<string, Addon[]>();

	constructor(addons: Addon[]) {
		for (const addon of addons) {
			if (!addon.installationId) continue;
			for (const key of identityKeys(addon)) {
				const list = this.#byKey.get(key);
				if (list) list.push(addon);
				else this.#byKey.set(key, [addon]);
			}
		}
	}

	/** The installed copies of `addon`, one per installation at most. */
	matches(addon: AddonIdentity): Addon[] {
		const byInstallation = new Map<string, Addon>();
		for (const key of identityKeys(addon)) {
			for (const match of this.#byKey.get(key) ?? []) {
				if (!byInstallation.has(match.installationId!)) {
					byInstallation.set(match.installationId!, match);
				}
			}
		}
		return [...byInstallation.values()];
	}

	/**
	 * The installations, in the user's order, that have `addon` — leaving out `excludeId`,
	 * normally the installation on screen, whose status the page already shows.
	 */
	installationsWith(
		addon: AddonIdentity,
		installations: WowInstallation[],
		excludeId?: string
	): WowInstallation[] {
		const ids = new Set(this.matches(addon).map((a) => a.installationId));
		return installations.filter((i) => i.id !== excludeId && ids.has(i.id));
	}

	/** The copy of `addon` installed in `installationId`, if there is one. */
	findIn(addon: AddonIdentity, installationId: string): Addon | undefined {
		return this.matches(addon).find((a) => a.installationId === installationId);
	}
}
