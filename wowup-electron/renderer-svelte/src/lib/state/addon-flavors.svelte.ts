// The user's installed addons across all their WoW installations, indexed so Get Addons and
// My Addons can ask "which other flavors have this addon?" for every row without a storage
// round trip each. See services/addon-flavors.ts for what counts as the same addon.

import type { WowInstallation } from 'wowup-lib-core';
import * as addonStorage from '$lib/services/addon-storage';
import { AddonFlavorIndex, type AddonIdentity } from '$lib/services/addon-flavors';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';

class AddonFlavors {
	index = $state.raw(new AddonFlavorIndex([]));

	/** Responses can arrive out of order; only the newest request may replace the index. */
	#request = 0;

	/** Re-reads every installation's addons. Cheap: one storage read, no file scanning. */
	async refresh(): Promise<void> {
		const request = ++this.#request;
		try {
			const addons = await addonStorage.getAll();
			if (request === this.#request) this.index = new AddonFlavorIndex(addons);
		} catch (e) {
			console.warn('[addon-flavors] could not read installed addons', e);
		}
	}

	/** Installations other than `excludeId` that have `addon`, in the user's order. */
	installedIn(addon: AddonIdentity, excludeId?: string): WowInstallation[] {
		return this.index.installationsWith(addon, warcraftInstallations.installations, excludeId);
	}

	findIn = (addon: AddonIdentity, installationId: string) =>
		this.index.findIn(addon, installationId);
}

export const addonFlavors = new AddonFlavors();
