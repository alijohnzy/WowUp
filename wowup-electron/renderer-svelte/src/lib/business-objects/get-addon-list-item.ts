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
			this.releasedAt = new Date(latestFile?.releaseDate ?? new Date()).getTime();
		}
	}
}
