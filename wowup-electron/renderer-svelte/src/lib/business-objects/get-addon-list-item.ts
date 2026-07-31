// Port of src/app/business-objects/get-addon-list-item.ts (38 LOC).
// Row model for the Get Addons grid. No Angular in the original — only the import paths change.

import { AddonChannelType, type AddonSearchResult } from 'wowup-lib-core';
import { AddonInstallState } from '$lib/models/addon-install-state';
import { getLatestFile } from '$lib/utils/search-result';

export class GetAddonListItem {
	readonly searchResult: AddonSearchResult;

	releasedAt = 0;
	downloadCount: number;
	name: string;
	thumbnailUrl: string;
	author: string;
	providerName: string;
	latestAddonChannel: AddonChannelType = AddonChannelType.Stable;
	canonicalName: string;

	installState: AddonInstallState = AddonInstallState.Unknown;

	get externalId(): string {
		return this.searchResult.externalId;
	}

	constructor(searchResult: AddonSearchResult, defaultAddonChannel?: AddonChannelType) {
		this.searchResult = searchResult;
		this.author = searchResult.author;
		this.name = searchResult.name;
		this.providerName = searchResult.providerName;
		this.thumbnailUrl = searchResult.thumbnailUrl;
		this.downloadCount = searchResult.downloadCount || 0;
		this.canonicalName = this.name.toLowerCase();

		if (defaultAddonChannel !== undefined) {
			const latestFile = getLatestFile(searchResult, defaultAddonChannel);
			this.latestAddonChannel = latestFile?.channelType ?? AddonChannelType.Stable;
			// `?? new Date()` only covers a missing releaseDate. A *present but unparseable*
			// one — which providers do return — makes getTime() NaN, and NaN travels: the Get
			// Addons grid fed it to `new Date(...).toISOString()`, which throws inside ag-grid's
			// render loop and blanked every row. Keep the field a usable number here rather than
			// relying on each consumer to re-check it.
			const released = new Date(latestFile?.releaseDate ?? new Date()).getTime();
			this.releasedAt = Number.isNaN(released) ? 0 : released;
		}
	}
}
