import * as path from '$lib/utils/path';

import {
	WOWUP_ADDON_FOLDER_NAME,
	WOWUP_ASSET_FOLDER_NAME,
	WOWUP_DATA_ADDON_FOLDER_NAME
} from '$common/constants';
import { AddonInstallState } from '$lib/models/addon-install-state';
import { toInterfaceVersion } from '$lib/utils/addon';
import { WowUpCompanionAddonProvider } from '$lib/addon-providers/wowup-companion-addon-provider';
import { addonService, onAddonInstalled } from '$lib/state/addon.svelte';
import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
import * as fileService from '$lib/services/files';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
import { AddonChannelType } from 'wowup-lib-core';
import type { Addon } from 'wowup-lib-core';
import type { WowInstallation } from 'wowup-lib-core';
import { warcraft } from '$lib/state/warcraft.svelte';

enum WowUpAddonFileType {
	Raw,
	HandlebarsTemplate
}

interface WowUpAddonVersion {
	name: string;
	currentVersion: string;
	newVersion: string;
}

interface WowUpAddonData {
	updatesAvailable: WowUpAddonVersion[];
	generatedAt: string;
	interfaceVersion: string;
	wowUpAddonName: string;
	wowUpAddonVersion: string;
}

interface WowUpAddonFileProcessing {
	type: WowUpAddonFileType;
	filename: string;
}

class WowUpAddonService {
	public readonly files: WowUpAddonFileProcessing[] = [
		{
			filename: 'data.lua',
			type: WowUpAddonFileType.HandlebarsTemplate
		},
		{
			filename: 'wowup_data_addon.toc',
			type: WowUpAddonFileType.HandlebarsTemplate
		},
		{
			filename: 'ldbicon.tga',
			type: WowUpAddonFileType.Raw
		}
	];
	private compiledFiles: Record<string, (data: unknown) => string> = {};

	/** Replaces two constructor-time rxjs subscriptions. Call once from the layout. */
	public start(): void {
		onAddonInstalled((update: AddonUpdateEvent) => {
			if (update.installState !== AddonInstallState.Complete) return;

			const installation = warcraftInstallations.getWowInstallation(
				update.addon.installationId ?? ''
			);
			if (!installation) return;

			this.updateForInstallation(installation).catch((e) => console.error(e));
		});

		addonService.addonRemoved.subscribe(() => {
			this.updateForAllClientTypes().catch((e) => console.error(e));
		});
	}

	public async updateForAllClientTypes(): Promise<void> {
		const installations = await warcraftInstallations.getWowInstallationsAsync();

		for (const installation of installations) {
			try {
				await this.updateForInstallation(installation);
			} catch (e) {
				console.error(e);
			}
		}
	}

	public async updateForInstallation(installation: WowInstallation): Promise<void> {
		const addons = await addonService.getAllAddons(installation);
		if (addons.length === 0) {
			console.log(`WowUpAddonService: No addons to sync ${installation.displayName}`);
			return;
		}

		await this.persistUpdateInformationToWowUpAddon(installation, addons);
		await this.syncCompanionAddon(addons, installation);
	}

	private async syncCompanionAddon(addons: Addon[], installation: WowInstallation): Promise<void> {
		const companionAddon = this.getCompanionAddon(addons);
		if (!companionAddon) {
			console.debug(`No wow companion found: ${installation.displayName}`);
			return;
		}

		const addonFolderPath = warcraft.getAddonFolderPath(installation);
		const addonFolder = await warcraft.getAddonFolder(
			addonFolderPath,
			WOWUP_DATA_ADDON_FOLDER_NAME
		);
		if (addonFolder === undefined) {
			console.warn('Could not find addon folder', addonFolderPath);
			return;
		}

		const provider = new WowUpCompanionAddonProvider();
		await provider.scan(installation, AddonChannelType.Stable, [addonFolder]);

		if (companionAddon) {
			const updatedCompanion: Addon = { ...companionAddon };
			await addonService.saveAddon(updatedCompanion);
		}
	}

	private async persistUpdateInformationToWowUpAddon(
		installation: WowInstallation,
		addons: Addon[]
	) {
		const wowUpAddon = this.findAddonByFolderName(addons, WOWUP_ADDON_FOLDER_NAME);
		if (!wowUpAddon) {
			console.debug(`WowUp Addon not found: ${installation.displayName}`);
			return;
		}

		console.log(
			'Found the WowUp addon notification addon, trying to sync updates available to wowup_data_addon'
		);
		try {
			const availableUpdates = addons.filter(this.canUpdateAddon).map(this.getAddonVersion);

			let interfaceVersion = '';

			try {
				interfaceVersion = toInterfaceVersion(wowUpAddon.gameVersion?.[0] || '');
			} catch (e) {
				console.error(e);
			}

			const wowUpAddonData: WowUpAddonData = {
				updatesAvailable: availableUpdates,
				generatedAt: new Date().toString(),
				interfaceVersion,
				wowUpAddonName: wowUpAddon.installedFolders ?? '',
				wowUpAddonVersion: wowUpAddon.installedVersion ?? ''
			};

			const dataAddonPath = path.join(
				warcraft.getAddonFolderPath(installation),
				WOWUP_DATA_ADDON_FOLDER_NAME
			);

			const pathExists = await fileService.pathExists(dataAddonPath);
			if (!pathExists) {
				await fileService.createDirectory(dataAddonPath);
			}

			for (const file of this.files) {
				const designatedPath = path.join(dataAddonPath, file.filename);
				switch (file.type) {
					case WowUpAddonFileType.HandlebarsTemplate:
						await this.handleHandlebarsTemplateFileType(file, designatedPath, wowUpAddonData);
						break;
					case WowUpAddonFileType.Raw:
						await this.handleRawFileType(file, designatedPath);
						break;
					default:
						break;
				}
			}

			console.log(
				'Available update data synced to wowup_data_addon/{data.lua,wowup_data_addon.toc}'
			);
		} catch (e) {
			console.error(e);
		}
	}

	private getAddonVersion = (addon: Addon): WowUpAddonVersion => {
		return {
			name: addon.name,
			currentVersion: addon.installedVersion ?? '',
			newVersion: addon.latestVersion ?? ''
		};
	};

	private canUpdateAddon = (addon: Addon) => {
		return (
			!addon.isIgnored && !addon.autoUpdateEnabled && addon.latestVersion !== addon.installedVersion
		);
	};

	private async handleHandlebarsTemplateFileType(
		file: WowUpAddonFileProcessing,
		designatedPath: string,
		wowUpAddonData: WowUpAddonData
	) {
		const assetPath = path.join(WOWUP_ASSET_FOLDER_NAME, `${file.filename}.hbs`);
		const templatePath = await fileService.getAssetFilePath(assetPath);
		const templateContents = await fileService.readFile(templatePath);

		if (!this.compiledFiles[file.filename]) {
			this.compiledFiles[file.filename] = (
				window as unknown as {
					libs: { handlebars: { compile: (t: string) => (d: unknown) => string } };
				}
			).libs.handlebars.compile(templateContents);
		}

		const fileData: string = this.compiledFiles[file.filename](wowUpAddonData).toString();
		await fileService.writeFile(designatedPath, fileData);
	}

	private async handleRawFileType(file: WowUpAddonFileProcessing, designatedPath: string) {
		const assetPath = path.join(WOWUP_ASSET_FOLDER_NAME, file.filename);
		const filePath = await fileService.getAssetFilePath(assetPath);
		const exists = await fileService.pathExists(designatedPath);
		if (exists) {
			console.log(`File exists, skipping copy: ${designatedPath}`);
		} else {
			await fileService.copy(filePath, designatedPath);
		}
	}

	private getCompanionAddon(addons: Addon[]): Addon | undefined {
		return this.findAddonByFolderName(addons, WOWUP_DATA_ADDON_FOLDER_NAME);
	}

	private findAddonByFolderName(addons: Addon[], folderName: string): Addon | undefined {
		return addons.find(
			(addon: Addon) =>
				Array.isArray(addon.installedFolderList) && addon.installedFolderList.includes(folderName)
		);
	}
}

export const wowUpAddon = new WowUpAddonService();
