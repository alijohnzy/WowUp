// Port of src/app/services/warcraft/warcraft-installation.service.ts (309 LOC).
//
// Removed: @Injectable + 5-service DI, ReplaySubject/Subject, `uuid`, Node `path`, and 8
// lodash calls (_.filter/_.forEach/_.findIndex/_.first/_.remove) that are all native.
//
// Behavioural note: the Angular version did async work in its constructor — a DI-time
// subscribe plus an rxjs pipeline fetching the Blizzard agent path. That made the service's
// readiness implicit and untestable. Here it is an explicit `init()` the root layout awaits.

import { WOW_INSTALLATIONS_KEY } from '$common/constants';
import { getWowClientFolderName } from '$common/warcraft';
import {
	AddonChannelType,
	getEnumName,
	getWowClientGroupForType,
	WowClientType,
	type WowClientGroup,
	type WowInstallation
} from 'wowup-lib-core';
import { preferenceStorage } from '$lib/services/storage';
import { electron } from '$lib/state/electron.svelte';
import { warcraft } from '$lib/state/warcraft.svelte';
import { i18n } from '$lib/i18n.svelte';
import { join } from '$lib/utils/path';

const DEFAULT_NAME_TOKEN = '{defaultName}';

interface OpenDialogReturnValue {
	canceled: boolean;
	filePaths: string[];
}

class WarcraftInstallations {
	/** Was a ReplaySubject(1) read through `| async` in ~6 templates. */
	installations = $state<WowInstallation[]>([]);
	blizzardAgentPath = $state('');

	#initialized = false;

	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		try {
			this.blizzardAgentPath = await warcraft.getBlizzardAgentPath();
		} catch (e) {
			console.error('Failed to get blizzard agent path', e);
		}
		await this.importWowInstallations(this.blizzardAgentPath);
	}

	/**
	 * Saved display names are unreliable — a language change or an expansion release
	 * invalidates them — so they are always regenerated from the label + client type.
	 */
	async #refreshDisplayNames(installations: WowInstallation[]): Promise<void> {
		for (const installation of installations) {
			const typeName = getEnumName(WowClientType, installation.clientType);
			try {
				installation.displayName = await this.#getDisplayName(installation.label, typeName);
			} catch {
				/* leave the stored name in place */
			}
		}
	}

	async #publish(installations: WowInstallation[]): Promise<void> {
		await this.#refreshDisplayNames(installations);
		this.installations = installations;
	}

	async getWowInstallationsAsync(): Promise<WowInstallation[]> {
		return (await preferenceStorage.getObjectAsync<WowInstallation[]>(WOW_INSTALLATIONS_KEY)) ?? [];
	}

	getWowInstallation(installationId: string | undefined): WowInstallation | undefined {
		if (!installationId) {
			console.warn('getWowInstallation invalid installationId');
			return undefined;
		}
		return this.installations.find((installation) => installation.id === installationId);
	}

	async getWowInstallationsByClientType(clientType: WowClientType): Promise<WowInstallation[]> {
		return (await this.getWowInstallationsAsync()).filter((i) => i.clientType === clientType);
	}

	async getWowInstallationsByClientTypes(clientTypes: WowClientType[]): Promise<WowInstallation[]> {
		return (await this.getWowInstallationsAsync()).filter((i) =>
			clientTypes.includes(i.clientType)
		);
	}

	async getWowInstallationsByClientGroups(
		clientGroups: WowClientGroup[]
	): Promise<WowInstallation[]> {
		return (await this.getWowInstallationsAsync()).filter((i) =>
			clientGroups.includes(getWowClientGroupForType(i.clientType))
		);
	}

	async setWowInstallations(wowInstallations: WowInstallation[]): Promise<void> {
		console.log(`Setting wow installations: ${wowInstallations.length}`);
		await preferenceStorage.setAsync(WOW_INSTALLATIONS_KEY, wowInstallations);
	}

	async setSelectedWowInstallation(wowInstallation: WowInstallation): Promise<void> {
		const all = await this.getWowInstallationsAsync();
		for (const installation of all) installation.selected = installation.id === wowInstallation.id;
		await this.setWowInstallations(all);
	}

	getInstallationDisplayName(wowInstallation: WowInstallation): Promise<string> {
		return this.#getDisplayName(
			wowInstallation.label,
			getEnumName(WowClientType, wowInstallation.clientType)
		);
	}

	async reOrderInstallation(installationId: string, direction: number): Promise<void> {
		const originIndex = this.installations.findIndex((i) => i.id === installationId);
		if (originIndex === -1) {
			console.warn('Installation not found to re-order', installationId);
			return;
		}

		const newIndex = originIndex + direction;
		if (newIndex < 0 || newIndex >= this.installations.length) {
			console.warn('New index was out of bounds');
			return;
		}

		const copy = [...this.installations];
		[copy[newIndex], copy[originIndex]] = [copy[originIndex], copy[newIndex]];

		await this.setWowInstallations(copy);
		await this.#publish(copy);
	}

	async updateWowInstallation(wowInstallation: WowInstallation): Promise<void> {
		wowInstallation.displayName = await this.#getDisplayName(
			wowInstallation.label,
			getEnumName(WowClientType, wowInstallation.clientType)
		);

		const stored = await this.getWowInstallationsAsync();
		const matchIndex = stored.findIndex((i) => i.id === wowInstallation.id);
		if (matchIndex === -1) throw new Error('No installation to update');

		stored.splice(matchIndex, 1, wowInstallation);
		await this.setWowInstallations(stored);
		await this.#publish(stored);
	}

	async addInstallation(installation: WowInstallation, notify = true): Promise<void> {
		const existing = await this.getWowInstallationsAsync();
		if (existing.some((inst) => inst.location === installation.location)) {
			throw new Error(`Installation already exists: ${installation.location}`);
		}

		existing.push(installation);
		await this.setWowInstallations(existing);
		if (notify) await this.#publish(existing);
	}

	async removeWowInstallation(installation: WowInstallation): Promise<void> {
		const installations = await this.getWowInstallationsAsync();
		if (!installations.some((inst) => inst.id === installation.id)) {
			throw new Error(`Installation does not exist: ${installation.id}`);
		}

		const remaining = installations.filter((inst) => inst.id !== installation.id);
		await this.setWowInstallations(remaining);
		await this.#publish(remaining);
	}

	async selectWowClientPath(): Promise<string> {
		const selectionName = i18n.t('COMMON.WOW_EXE_SELECTION_NAME');
		const extensionFilter = await warcraft.getExecutableExtension();

		// Platforms like Linux have no meaningful executable extension.
		const dialogResult = await electron.showOpenDialog<OpenDialogReturnValue>(
			extensionFilter
				? {
						filters: [{ extensions: [extensionFilter], name: selectionName }],
						properties: ['openFile']
					}
				: { properties: ['openFile'] }
		);

		if (dialogResult.canceled) return '';

		const selectedPath = dialogResult.filePaths[0];
		if (!selectedPath) {
			console.warn('No path selected');
			return '';
		}
		return selectedPath;
	}

	async createWowInstallationForPath(applicationPath: string): Promise<WowInstallation> {
		const clientType = await warcraft.getClientTypeForBinary(applicationPath);
		const typeName = getEnumName(WowClientType, clientType);
		const current = await this.getWowInstallationsByClientType(clientType);
		const label = current.length
			? `${DEFAULT_NAME_TOKEN} ${current.length + 1}`
			: DEFAULT_NAME_TOKEN;

		return {
			id: crypto.randomUUID(),
			clientType,
			defaultAddonChannelType: AddonChannelType.Stable,
			defaultAutoUpdate: false,
			label,
			displayName: await this.#getDisplayName(label, typeName),
			location: applicationPath,
			selected: false
		};
	}

	async importWowInstallations(blizzardAgentPath: string): Promise<void> {
		if (!blizzardAgentPath) {
			console.log('Cannot import wow installations, no agent path');
			await this.#publish(await this.getWowInstallationsAsync());
			return;
		}

		const installedProducts = await warcraft.getInstalledProducts(blizzardAgentPath);

		for (const product of Array.from(installedProducts.values())) {
			const typeName = getEnumName(WowClientType, product.clientType);
			const current = await this.getWowInstallationsByClientType(product.clientType);
			const label = current.length
				? `${DEFAULT_NAME_TOKEN} ${current.length + 1}`
				: DEFAULT_NAME_TOKEN;

			const fullProductPath = await this.#getFullProductPath(product.location, product.clientType);
			if (current.some((inst) => inst.location === fullProductPath)) continue;

			try {
				await this.addInstallation(
					{
						id: crypto.randomUUID(),
						clientType: product.clientType,
						label,
						displayName: await this.#getDisplayName(label, typeName),
						location: fullProductPath,
						selected: false,
						defaultAddonChannelType: AddonChannelType.Stable,
						defaultAutoUpdate: false
					},
					false
				);
			} catch {
				// Duplicate location — already imported.
			}
		}

		await this.#publish(await this.getWowInstallationsAsync());
	}

	async #getDisplayName(label: string, typeName: string): Promise<string> {
		const defaultName = i18n.t(`COMMON.CLIENT_TYPES.${typeName.toUpperCase()}`);
		const finalLabel = label.replace(DEFAULT_NAME_TOKEN, defaultName);

		if (finalLabel.includes(DEFAULT_NAME_TOKEN)) {
			throw new Error(`Default token in name: ${label} => ${typeName} `);
		}
		return finalLabel;
	}

	async #getFullProductPath(location: string, clientType: WowClientType): Promise<string> {
		const clientFolderName = getWowClientFolderName(clientType);
		const executableName = await warcraft.getExecutableName(clientType);
		return join(location, clientFolderName, executableName);
	}
}

export const warcraftInstallations = new WarcraftInstallations();
