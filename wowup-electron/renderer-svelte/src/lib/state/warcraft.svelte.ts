// Port of src/app/services/warcraft/warcraft.service.ts (180 LOC, 3 BehaviorSubjects).
//
// Removed: @Injectable + 3-service DI, Node `path` (-> $lib/utils/path).
// The `installedClientTypesSelectItems$` observable pipeline (filter + map over a subject,
// consumed by an `| async` in a template) becomes a $derived — one line, no subscription.

import * as constants from '$common/constants';
import { getEnumList, getEnumName, WowClientType } from 'wowup-lib-core';
import type { AddonFolder, InstalledProduct, Toc, WowInstallation } from 'wowup-lib-core';
import * as warcraftApi from '$lib/services/warcraft-api';
import { listDirectories, pathExists, readdir, statFiles } from '$lib/services/files';
import { parse as parseToc } from '$lib/services/toc';
import { basename, dirname, extname, join } from '$lib/utils/path';

export interface SelectItem<T> {
	display: string;
	value: T;
}

const ALL_CLIENT_TYPES = getEnumList<WowClientType>(WowClientType).filter(
	(clientType) => clientType !== WowClientType.None
);

class Warcraft {
	products = $state<InstalledProduct[]>([]);
	installedClientTypes = $state<WowClientType[] | undefined>(undefined);

	/** Was an rxjs filter+map pipeline read through `| async`. */
	installedClientTypeSelectItems = $derived<SelectItem<WowClientType>[]>(
		(this.installedClientTypes ?? []).map((ct) => ({
			display: `COMMON.CLIENT_TYPES.${getEnumName(WowClientType, ct).toUpperCase()}`,
			value: ct
		}))
	);

	getAllClientTypes = (): WowClientType[] => [...ALL_CLIENT_TYPES];

	getExecutableName = (clientType: WowClientType): Promise<string> =>
		warcraftApi.getExecutableName(clientType);
	getExecutableExtension = (): Promise<string> => warcraftApi.getExecutableExtension();
	getBlizzardAgentPath = (): Promise<string> => warcraftApi.getBlizzardAgentPath();
	getClientTypeForBinary = (binaryPath: string): Promise<WowClientType> =>
		warcraftApi.getClientTypeForBinary(binaryPath);
	getInstalledProducts = (
		blizzardAgentPath: string
	): Promise<Map<WowClientType, InstalledProduct>> =>
		warcraftApi.getInstalledProducts(blizzardAgentPath);

	async isWowApplication(appPath: string): Promise<boolean> {
		if (!(await pathExists(appPath))) return false;
		return warcraftApi.isWowApplication(basename(appPath));
	}

	getProductLocation(
		clientType: WowClientType,
		installedProducts: Map<WowClientType, InstalledProduct>
	): string {
		return installedProducts.get(clientType)?.location ?? '';
	}

	getAddonFolderPath(installation: WowInstallation): string {
		return join(
			dirname(installation.location),
			constants.WOW_INTERFACE_FOLDER_NAME,
			constants.WOW_ADDON_FOLDER_NAME
		);
	}

	async listAddons(installation: WowInstallation, scanSymlinks = false): Promise<AddonFolder[]> {
		const addonFolders: AddonFolder[] = [];
		if (!installation) return addonFolders;

		const addonFolderPath = this.getAddonFolderPath(installation);
		if (!(await pathExists(addonFolderPath))) return addonFolders;

		const directories = await listDirectories(addonFolderPath, scanSymlinks);
		const dirStats = await statFiles(directories.map((dir) => join(addonFolderPath, dir)));

		for (const dir of directories) {
			const addonFolder = await this.getAddonFolder(addonFolderPath, dir);
			if (!addonFolder) {
				console.warn(`Failed to get addonFolder, no toc found: ${dir}`);
				continue;
			}
			addonFolder.fileStats = dirStats[join(addonFolderPath, dir)];
			addonFolders.push(addonFolder);
		}

		return addonFolders;
	}

	async getAddonFolder(addonFolderPath: string, dir: string): Promise<AddonFolder | undefined> {
		try {
			const dirPath = join(addonFolderPath, dir);
			const dirFiles = await readdir(dirPath);
			const tocFiles = dirFiles.filter((f) => extname(f) === '.toc');
			if (tocFiles.length === 0) return undefined;

			const tocs: Toc[] = [];
			for (const tocFile of tocFiles) {
				tocs.push(await parseToc(join(dirPath, tocFile)));
			}

			return { name: dir, path: dirPath, status: 'Pending', tocs };
		} catch (e) {
			console.error(e);
			return undefined;
		}
	}

	/** @deprecated retained for migrating pre-2.x preference keys */
	getLegacyClientLocationKey(clientType: WowClientType): string {
		switch (clientType) {
			case WowClientType.Retail:
				return constants.RETAIL_LOCATION_KEY;
			case WowClientType.Classic:
			case WowClientType.ClassicEra:
				return constants.CLASSIC_LOCATION_KEY;
			case WowClientType.RetailPtr:
				return constants.RETAIL_PTR_LOCATION_KEY;
			case WowClientType.ClassicPtr:
				return constants.CLASSIC_PTR_LOCATION_KEY;
			case WowClientType.Beta:
				return constants.BETA_LOCATION_KEY;
			default:
				throw new Error(
					`Failed to get client location key: ${clientType}, ${getEnumName(WowClientType, clientType)}`
				);
		}
	}
}

export const warcraft = new Warcraft();
