import { httpFetch } from '$lib/http';
import * as _ from '$lib/utils/collection';
import { basename, join } from '$lib/utils/path';

import { ADDON_PROVIDER_ZIP } from '$common/constants';
import * as files from '$lib/services/files';
import * as tocService from '$lib/services/toc';
import { warcraft } from '$lib/state/warcraft.svelte';
import { AddonChannelType, AddonProvider } from 'wowup-lib-core';
import type {
	Addon,
	AddonSearchResult,
	AddonSearchResultFile,
	SearchByUrlResult,
	Toc
} from 'wowup-lib-core';
import type { WowInstallation } from 'wowup-lib-core';

const VALID_ZIP_CONTENT_TYPES = [
	'application/zip',
	'application/x-zip-compressed',
	'application/octet-stream'
];

export class ZipAddonProvider extends AddonProvider {
	public readonly name = ADDON_PROVIDER_ZIP;
	public readonly forceIgnore = true;
	public readonly allowReinstall = false;
	public readonly allowChannelChange = false;
	public readonly allowEdit = false;
	public readonly allowReScan = false;
	public readonly canShowChangelog = false;
	public enabled = true;

	public constructor() {
		super();
	}

	public isValidAddonUri(addonUri: URL): boolean {
		return addonUri.pathname?.toLowerCase()?.endsWith('.zip');
	}

	public isValidAddonId(): boolean {
		return false;
	}

	public async getDescription(
		installation: WowInstallation,
		externalId: string,
		addon?: Addon
	): Promise<string> {
		if (!addon) {
			return '';
		}

		const folders = addon?.installedFolderList ?? [];
		const clientAddonFolderPath = warcraft.getAddonFolderPath(installation);
		const allTocs = await this.getAllTocs(clientAddonFolderPath, folders);

		const primaryToc = this.getPrimaryToc(allTocs);
		if (!primaryToc) {
			console.warn('No primary toc found');
			return '';
		}

		const lines = _.map(Object.entries(primaryToc), ([key, value]) => {
			if (typeof value === 'string' && !!value) {
				return `${key}: ${value}`;
			}
			return '';
		})
			.filter((str) => !!str)
			.map((str) => `<p>${str}</p>`)
			.join('');

		return lines;
	}

	private getPrimaryToc(tocs: Toc[]) {
		return _.maxBy(tocs, (toc) => Object.values(toc).join('').length);
	}

	private async getAllTocs(baseDir: string, installedFolders: string[]) {
		const tocs: Toc[] = [];

		for (const dir of installedFolders) {
			const dirPath = join(baseDir, dir);

			const tocFiles = await files.listFiles(dirPath, '*.toc');
			const tocFile = tocFiles[0];
			if (!tocFile) {
				continue;
			}

			const tocPath = join(dirPath, tocFile);
			const toc = await tocService.parse(tocPath);
			if (!toc.interface) {
				continue;
			}

			tocs.push(toc);
		}

		return tocs;
	}

	public async searchByUrl(addonUri: URL): Promise<SearchByUrlResult> {
		if (!addonUri.pathname.toLowerCase().endsWith('.zip')) {
			throw new Error(`Invalid zip URL ${addonUri.toString()}`);
		}

		await this.validateUrlContentType(addonUri);

		const fileName = addonUri.pathname.split('/').at(-1) ?? 'unknown';
		const fileNameNoExt = basename(fileName, '.zip');

		const potentialFile: AddonSearchResultFile = {
			channelType: AddonChannelType.Stable,
			downloadUrl: addonUri.toString(),
			folders: [fileNameNoExt],
			gameVersion: '',
			version: fileNameNoExt,
			releaseDate: new Date(),
			changelog: ''
		};

		const potentialAddon: AddonSearchResult = {
			author: addonUri.hostname,
			downloadCount: 1,
			externalId: addonUri.toString(),
			externalUrl: addonUri.origin,
			name: fileName,
			providerName: this.name,
			thumbnailUrl: '',
			files: [potentialFile]
		};

		return {
			errors: [],
			searchResult: potentialAddon
		};
	}

	public override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
		const addonUri = new URL(addonId);

		if (!addonUri.pathname.toLowerCase().endsWith('.zip')) {
			throw new Error(`Invalid zip URL ${addonUri.toString()}`);
		}

		await this.validateUrlContentType(addonUri);

		const fileName = addonUri.pathname.split('/').at(-1) ?? 'unknown';

		const searchResultFile: AddonSearchResultFile = {
			channelType: AddonChannelType.Stable,
			downloadUrl: addonUri.toString(),
			folders: [],
			gameVersion: '',
			version: fileName,
			releaseDate: new Date()
		};

		const potentialAddon: AddonSearchResult = {
			author: '',
			downloadCount: 1,
			externalId: addonUri.toString(),
			externalUrl: addonUri.origin,
			name: fileName,
			providerName: this.name,
			thumbnailUrl: '',
			files: [searchResultFile]
		};

		return potentialAddon;
	}

	private async validateUrlContentType(addonUri: URL) {
		const response = await this.getUrlInfo(addonUri);
		const contentType = response.headers.get('content-type') ?? '';
		if (!VALID_ZIP_CONTENT_TYPES.includes(contentType)) {
			throw new Error(`Invalid zip content type ${contentType}`);
		}
	}

	private async getUrlInfo(addonUri: URL): Promise<Response> {
		// Was HttpClient.head(...).toPromise(); fetch exposes the headers directly.
		return await httpFetch(addonUri.toString(), { method: 'HEAD' });
	}
}
