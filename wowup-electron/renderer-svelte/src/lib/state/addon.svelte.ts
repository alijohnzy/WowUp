// Port of src/app/services/addons/addon.service.ts (1,817 LOC) — the hub the rest of the
// app hangs off.
//
// Removed: @Injectable + 10-service DI, 9 Subjects, `uuid`, Node `path`, and ~25 lodash
// calls. Two methods that returned Observables purely so callers could `.toPromise()` them
// (`getAddon`, `getFeaturedAddons`) now return Promises directly.
//
// The Angular constructor wired five rxjs subscriptions at DI time, including one that
// reacted to its own output. That is replaced by an explicit `init()` plus a single
// `#refreshUpdatesAvailable()` called from the three places that can change the answer.

import {
	ADDON_PROVIDER_CURSEFORGE,
	ADDON_PROVIDER_HUB,
	ADDON_PROVIDER_HUB_LEGACY,
	ADDON_PROVIDER_RAIDERIO,
	ADDON_PROVIDER_TUKUI,
	ADDON_PROVIDER_UNKNOWN,
	ADDON_PROVIDER_WAGO,
	ADDON_PROVIDER_WOWINTERFACE,
	ADDON_PROVIDER_WOWUP_COMPANION,
	ERROR_ADDON_ALREADY_INSTALLED,
	USER_ACTION_ADDON_PROTOCOL_SEARCH,
	USER_ACTION_ADDON_SEARCH,
	USER_ACTION_BROWSE_CATEGORY
} from '$common/constants';
import {
	AddonChannelType,
	AddonDependencyType,
	AddonCategory,
	AddonWarningType,
	getEnumName,
	getGameVersionList,
	WowClientType,
	type Addon,
	type AddonDependency,
	type AddonExternalId,
	type AddonFolder,
	type AddonProvider,
	type AddonSearchResult,
	type AddonSearchResultDependency,
	type AddonSearchResultFile,
	type ProtocolSearchResult,
	type SearchByUrlResult,
	type Toc,
	type WowInstallation,
	type WowUpAddonProvider
} from 'wowup-lib-core';
import { AddonScanError, AddonSyncError, GenericProviderError } from '$lib/errors';
import { AddonInstallState } from '$lib/models/addon-install-state';
import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
import type { CurseAddonProvider } from '$lib/addon-providers/curse-addon-provider';
import * as _ from '$lib/utils/collection';
import * as addonUtils from '$lib/utils/addon';
import * as searchResults from '$lib/utils/search-result';
import { strIsNotNullOrEmpty } from '$lib/utils/string';
import { delayMs } from '$lib/utils/misc';
import { join } from '$lib/utils/path';
import * as addonStorage from '$lib/services/addon-storage';
import { getFingerprints } from '$lib/services/addon-fingerprint';
import * as files from '$lib/services/files';
import * as tocService from '$lib/services/toc';
import { trackAction } from '$lib/services/analytics';
import {
	addonInstall,
	type InstallQueueItem,
	type InstallType
} from '$lib/state/addon-install.svelte';
import { addonProviders } from '$lib/state/addon-providers.svelte';
import { warcraft } from '$lib/state/warcraft.svelte';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
import { wowup } from '$lib/state/wowup.svelte';

export enum ScanUpdateType {
	Start,
	Update,
	Complete,
	Unknown
}

export interface ScanUpdate {
	type: ScanUpdateType;
	totalCount?: number;
	currentCount?: number;
}

export type AddonActionType = 'scan' | 'sync';

export interface AddonActionEvent {
	type: AddonActionType;
	addon?: Addon;
}

const ADDON_PROVIDER_TOC_EXTERNAL_ID_MAP: Record<string, keyof Toc> = {
	[ADDON_PROVIDER_WOWINTERFACE]: 'wowInterfaceId',
	[ADDON_PROVIDER_TUKUI]: 'tukUiProjectId',
	[ADDON_PROVIDER_CURSEFORGE]: 'curseProjectId',
	[ADDON_PROVIDER_WAGO]: 'wagoAddonId'
};

type Listener<T> = (value: T) => void;

class Emitter<T> {
	#listeners = new Set<Listener<T>>();
	subscribe(fn: Listener<T>): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}
	emit(value: T): void {
		for (const fn of this.#listeners) fn(value);
	}
}

class AddonService {
	// State — read directly in templates instead of through `| async`.
	anyUpdatesAvailable = $state(false);

	/**
	 * Bumped every time the set of updatable addons is re-counted.
	 *
	 * `anyUpdatesAvailable` is a boolean, so anything deriving from it only recomputes when
	 * the answer flips. Installing one of three pending updates leaves it `true`, which left
	 * the client selector's "N updates" badge showing the count from before the install —
	 * it only caught up once the *last* update was installed and the flag went false.
	 */
	updatesRevision = $state(0);
	syncing = $state(false);
	scanUpdate = $state<ScanUpdate>({ type: ScanUpdateType.Unknown });
	activeInstalls = $state<AddonUpdateEvent[]>([]);

	// Occurrences — kept as emitters, since collapsing them to state would drop events.
	readonly addonAction = new Emitter<AddonActionEvent>();
	readonly addonRemoved = new Emitter<string>();
	readonly syncError = new Emitter<AddonSyncError>();
	readonly scanError = new Emitter<AddonScanError>();
	readonly searchError = new Emitter<GenericProviderError>();

	#initialized = false;

	/** Replaces five constructor-time rxjs subscriptions. */
	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		addonInstall.onAddonInstalled((evt) => {
			this.#updateActiveInstall(evt);
			void this.#refreshUpdatesAvailable();
		});
		addonInstall.onAddonRemoved(() => void this.#refreshUpdatesAvailable());
		this.addonRemoved.subscribe(() => void this.#refreshUpdatesAvailable());

		await this.#refreshUpdatesAvailable();
	}

	/** Prune addons whose WoW installation no longer exists. Was a wowInstallations$ pipe. */
	async reconcileOrphanAddonsForCurrentInstallations(): Promise<void> {
		const installations = await warcraftInstallations.getWowInstallationsAsync();
		if (installations.length === 0) return;
		try {
			await this.reconcileOrphanAddons(installations);
		} catch (e) {
			console.error('reconcileOrphanAddons failed', e);
		}
	}

	async #refreshUpdatesAvailable(): Promise<void> {
		this.anyUpdatesAvailable = (await this.getAllAddonsAvailableForUpdate()).length > 0;
		this.updatesRevision++;
	}

	// ---- install progress ---------------------------------------------------------

	isInstalling(addonId?: string): boolean {
		if (!addonId) return this.activeInstalls.length > 0;
		return this.activeInstalls.some((install) => install.addon.id === addonId);
	}

	getInstallStatus = (addonId: string): AddonUpdateEvent | undefined =>
		this.activeInstalls.find((install) => install.addon.id === addonId);

	#updateActiveInstall(updateEvent: AddonUpdateEvent): void {
		const itemIdx = this.activeInstalls.findIndex(
			(install) => install.addon.id === updateEvent.addon.id
		);

		if (itemIdx === -1) {
			this.activeInstalls.push(updateEvent);
			return;
		}

		if ([AddonInstallState.Complete, AddonInstallState.Error].includes(updateEvent.installState)) {
			this.activeInstalls.splice(itemIdx, 1);
		} else {
			this.activeInstalls[itemIdx] = updateEvent;
		}
	}

	// ---- queries ------------------------------------------------------------------

	async hasUpdatesAvailable(installation: WowInstallation): Promise<boolean> {
		const addons = await this.getAddons(installation);
		return addons.some((addon) => addonUtils.needsUpdate(addon));
	}

	addonMatchesSearchResult = (addon1: Addon, addon2: AddonSearchResult): boolean =>
		addon1?.externalId?.toString() === addon2?.externalId?.toString() &&
		addon1.providerName === addon2.providerName;

	async getCategoryPage(
		category: AddonCategory,
		installation: WowInstallation
	): Promise<AddonSearchResult[]> {
		trackAction(USER_ACTION_BROWSE_CATEGORY, {
			clientType: getEnumName(WowClientType, installation.clientType),
			category: getEnumName(AddonCategory, category)
		});

		const resultSet: AddonSearchResult[][] = [];
		for (const provider of addonProviders.getEnabledAddonProviders()) {
			try {
				resultSet.push(await provider.getCategory(category, installation));
			} catch (e) {
				console.error(e);
			}
		}
		return resultSet.flat();
	}

	async getFullDescription(
		installation: WowInstallation,
		providerName: string,
		externalId: string,
		addon?: Addon
	): Promise<string> {
		const provider = addonProviders.getProvider(providerName);
		if (!provider) return '';
		return await provider.getDescription(installation, externalId, addon);
	}

	async getChangelogForSearchResult(
		installation: WowInstallation,
		channelType: AddonChannelType,
		searchResult: AddonSearchResult
	): Promise<string> {
		try {
			const provider = addonProviders.getProvider(searchResult.providerName);
			if (!provider) return '';

			const latestFile = searchResults.getLatestFile(searchResult, channelType);
			if (!latestFile) throw new Error('Latest file not found');

			return await provider.getChangelog(
				installation,
				searchResult.externalId,
				latestFile.externalId ?? ''
			);
		} catch (e) {
			console.error('Failed to get searchResult changelog', e);
			return '';
		}
	}

	async getChangelogForAddon(installation: WowInstallation, addon: Addon): Promise<string> {
		if (!addon) return '';
		if (addon.latestChangelog && addon.latestChangelogVersion === addon.latestVersion) {
			return addon.latestChangelog;
		}

		try {
			const provider = addonProviders.getProvider(addon.providerName ?? '');
			if (!provider) return '';
			return await provider.getChangelog(
				installation,
				addon.externalId ?? '',
				addon.externalLatestReleaseId ?? ''
			);
		} catch (e) {
			console.error('Failed to get addon changelog', e);
			return '';
		}
	}

	async search(query: string, installation: WowInstallation): Promise<AddonSearchResult[]> {
		const providers = addonProviders.getEnabledAddonProviders();

		const results = await Promise.all(
			providers.map(async (p) => {
				try {
					return await p.searchByQuery(query, installation);
				} catch (e) {
					console.error(`Failed during search: ${p.name}`, e);
					this.searchError.emit(new GenericProviderError(e as Error, p.name));
					return [] as AddonSearchResult[];
				}
			})
		);

		trackAction(USER_ACTION_ADDON_SEARCH, {
			clientType: getEnumName(WowClientType, installation.clientType),
			query
		});

		return _.sortBy(results.flat(), (r) => r.downloadCount ?? 0).reverse();
	}

	/** Was an Observable that every caller immediately `.toPromise()`d. */
	async getAddon(
		externalId: string,
		providerName: string,
		installation: WowInstallation,
		targetFile?: AddonSearchResultFile
	): Promise<Addon | undefined> {
		const provider = addonProviders.getProvider(providerName);
		if (!provider) throw new Error(`Provider not found: ${providerName}`);

		const searchResult = await provider.getById(externalId, installation);
		if (!searchResult) {
			console.warn('provider get by id returned nothing');
			return undefined;
		}

		const latestFile = searchResults.getLatestFile(
			searchResult,
			installation.defaultAddonChannelType
		);
		if (!latestFile) {
			console.warn('Latest file not found');
			return undefined;
		}

		return this.#createAddon(searchResult, targetFile ?? latestFile, installation);
	}

	async getFeaturedAddons(installation: WowInstallation): Promise<AddonSearchResult[]> {
		const results = await Promise.all(
			addonProviders.getEnabledAddonProviders().map(async (p) => {
				try {
					return await p.getFeaturedAddons(installation);
				} catch (e) {
					console.error(`Failed to get featured addons: ${p.name}`, e);
					this.searchError.emit(new GenericProviderError(e as Error, p.name));
					return [] as AddonSearchResult[];
				}
			})
		);

		return _.sortBy(results.flat(), (r) => r.downloadCount ?? 0).reverse();
	}

	getAddonById = (addonId: string): Promise<Addon> => addonStorage.get(addonId);

	async getAddonByUrl(
		url: URL,
		installation: WowInstallation
	): Promise<SearchByUrlResult | undefined> {
		const provider = addonProviders.getAddonProviderForUri(url);
		if (!provider) {
			console.warn(`No provider found for url: ${url.toString()}`);
			return undefined;
		}
		return await provider.searchByUrl(url, installation);
	}

	async getAddonForProtocol(protocol: string): Promise<ProtocolSearchResult | undefined> {
		const addonProvider = addonProviders
			.getEnabledAddonProviders()
			.find((provider) => provider.isValidProtocol(protocol));

		if (!addonProvider) throw new Error(`No addon provider found for protocol ${protocol}`);

		trackAction(USER_ACTION_ADDON_PROTOCOL_SEARCH, { protocol });
		return await addonProvider.searchProtocol(protocol);
	}

	getRequiredDependencies = (addon: Addon): AddonDependency[] =>
		Array.isArray(addon.dependencies)
			? addon.dependencies.filter((dep) => dep.type === AddonDependencyType.Required)
			: [];

	getAllAddonsAvailableForUpdate = (wowInstallation?: WowInstallation): Promise<Addon[]> =>
		addonStorage.getAvailableForUpdate(wowInstallation?.id);

	getAutoUpdateEnabledAddons = (): Promise<Addon[]> => addonStorage.getAutoUpdateEnabled();

	getAllByExternalAddonId = (externalAddonIds: string[]): Promise<Addon[]> =>
		addonStorage.getByExternalIds(externalAddonIds);

	async hasAnyWithExternalAddonIds(externalAddonIds: string[]): Promise<boolean> {
		return (await this.getAllByExternalAddonId(externalAddonIds)).length > 0;
	}

	getAllAddons = (installation: WowInstallation): Promise<Addon[]> =>
		addonStorage.getAllForInstallationIdAsync(installation.id);

	getProviderAddons = (providerName: string): Promise<Addon[]> =>
		providerName ? addonStorage.getAllForProviderAsync(providerName) : Promise.resolve([]);

	getByExternalId = (
		externalId: string,
		providerName: string,
		installationId: string
	): Promise<Addon | undefined> =>
		addonStorage.getByExternalIdAsync(externalId, providerName, installationId);

	async isInstalled(
		externalId: string,
		providerName: string,
		installation: WowInstallation
	): Promise<boolean> {
		return !!(await this.getByExternalId(externalId, providerName, installation.id));
	}

	async getAddons(installation: WowInstallation, rescan = false): Promise<Addon[]> {
		if (!installation) return [];

		let addons = await addonStorage.getAllForInstallationIdAsync(installation.id);
		if (rescan || addons.length === 0) {
			addons = await this.rescanInstallation(installation);
		}
		return addons;
	}

	// ---- install / update / remove ----------------------------------------------------

	async installBaseAddon(
		externalId: string,
		providerName: string,
		installation: WowInstallation,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {},
		targetFile?: AddonSearchResultFile
	): Promise<Addon | undefined> {
		if (await this.getByExternalId(externalId, providerName, installation.id)) {
			throw new Error('Addon already installed');
		}

		const addon = await this.getAddon(externalId, providerName, installation, targetFile);
		if (addon?.id !== undefined) {
			await addonStorage.setAsync(addon.id, addon);
			await this.installAddon(addon, onUpdate);
			return addon;
		}
		return undefined;
	}

	async installPotentialAddon(
		potentialAddon: AddonSearchResult,
		installation: WowInstallation,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {},
		targetFile?: AddonSearchResultFile
	): Promise<void> {
		if (
			await this.getByExternalId(
				potentialAddon.externalId,
				potentialAddon.providerName,
				installation.id
			)
		) {
			throw new Error('Addon already installed');
		}

		const latestFile = searchResults.getLatestFile(
			potentialAddon,
			installation.defaultAddonChannelType
		);
		if (!latestFile) {
			console.warn('Latest file not found');
			return;
		}

		const addon = this.#createAddon(potentialAddon, targetFile ?? latestFile, installation);
		if (addon?.id !== undefined) await this.installAddon(addon, onUpdate);
	}

	updateAddon(
		addon: Addon,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {},
		originalAddon: Addon | undefined = undefined
	): Promise<void> {
		if (typeof addon !== 'object') return Promise.resolve();
		return this.installOrUpdateAddon(addon, 'update', onUpdate, originalAddon);
	}

	async installAddon(
		addon: Addon,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {},
		originalAddon: Addon | undefined = undefined
	): Promise<void> {
		if (typeof addon !== 'object') {
			console.warn('installAddon invalid addon id');
			return;
		}
		await this.installOrUpdateAddon(addon, 'install', onUpdate, originalAddon);
		await addonStorage.setAsync(addon.id, addon);
	}

	async installOrUpdateAddon(
		addon: Addon,
		installType: InstallType,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {},
		originalAddon: Addon | undefined = undefined
	): Promise<void> {
		if (typeof addon !== 'object' || !addon.downloadUrl) {
			console.error('installOrUpdateAddon invalid addon', addon);
			throw new Error(`Addon not found or invalid: ${addon?.id ?? 'unknown'}`);
		}

		const wowInstallation = this.#getWowInstallation(addon);
		const addonProvider = this.#getAddonProvider(addon);

		const wrappedOnUpdate = async (installState: AddonInstallState, progress: number) => {
			// A retry means the download URL may have expired — re-sync before trying again.
			if (installState === AddonInstallState.Retry) {
				await this.#syncProviderAddons(wowInstallation, [addon], addonProvider);
				await delayMs(1000);
				return;
			}
			onUpdate(installState, progress);
		};

		onUpdate(AddonInstallState.Pending, 0);

		let completion = { resolve: () => {}, reject: (_: unknown) => {} };
		const promise = new Promise<void>((resolve, reject) => {
			completion = { resolve, reject };
		});

		const installQueueItem: InstallQueueItem = {
			addon,
			onUpdate: wrappedOnUpdate,
			completion,
			installType,
			originalAddon: originalAddon ? { ...originalAddon } : undefined
		};

		addonInstall.enqueue(installQueueItem);
		return promise;
	}

	async installDependencies(
		addon: Addon,
		onUpdate: (installState: AddonInstallState, progress: number) => void = () => {}
	): Promise<void> {
		if (!addon.dependencies || !addon.providerName || !addon.installationId) {
			console.warn(`Invalid addon: ${addon.id ?? ''}`);
			return;
		}

		const requiredDependencies = this.getRequiredDependencies(addon);
		if (!requiredDependencies.length) {
			console.log(`${addon.name}: No required dependencies found`);
			return;
		}

		const maxCt = requiredDependencies.length;
		let currentCt = 0;

		for (const dependency of requiredDependencies) {
			currentCt += 1;
			onUpdate(AddonInstallState.Installing, (currentCt / maxCt) * 100);

			if (
				await this.getByExternalId(
					dependency.externalAddonId,
					addon.providerName,
					addon.installationId
				)
			) {
				continue;
			}

			const installation = warcraftInstallations.getWowInstallation(addon.installationId);
			if (!installation) throw new Error('Installation not found');

			const dependencyAddon = await this.getAddon(
				dependency.externalAddonId,
				addon.providerName,
				installation
			);

			if (!dependencyAddon || !dependencyAddon.id) {
				console.warn(
					`No addon was found EID: ${dependency.externalAddonId} CP: ${addon.providerName ?? ''} CT: ${addon.clientType}`
				);
				continue;
			}

			await addonStorage.setAsync(dependencyAddon.id, dependencyAddon);
			await this.installAddon(dependencyAddon);
		}
	}

	async processAutoUpdates(): Promise<Addon[]> {
		const autoUpdateAddons = await this.getAutoUpdateEnabledAddons();
		const addonsWithUpdates = autoUpdateAddons.filter((addon) => addonUtils.needsUpdate(addon));

		const results = await Promise.all(
			addonsWithUpdates.map((addon) =>
				typeof addon.id !== 'string'
					? Promise.resolve(undefined)
					: this.updateAddon(addon)
							.then(() => addon)
							.catch((e: unknown) => {
								console.error(e);
								return undefined;
							})
			)
		);

		return results.filter((res): res is Addon => res !== undefined);
	}

	async removeAddon(
		addon: Addon | undefined,
		removeDependencies = false,
		removeDirectories = true
	): Promise<void> {
		if (addon === undefined) throw new Error('Invalid addon');

		console.log(
			`[RemoveAddon] ${addon.providerName ?? ''} ${addon.externalId ?? 'NO_EXT_ID'} ${addon.name}`
		);

		const installedDirectories = addon.installedFolderList ?? [];
		if (removeDirectories && installedDirectories.length > 0) {
			const installation = warcraftInstallations.getWowInstallation(addon.installationId);
			if (!installation) {
				console.warn('No installation found for remove', addon.installationId);
				return;
			}

			const addonFolderPath = warcraft.getAddonFolderPath(installation);
			let failureCt = 0;

			for (const directory of installedDirectories) {
				const addonDirectory = join(addonFolderPath, directory);
				console.log(
					`[RemoveAddonDirectory] ${addon.providerName ?? ''} ${addon.externalId ?? 'NO_EXT_ID'} ${addonDirectory}`
				);
				try {
					await files.deleteIfExists(addonDirectory);
				} catch (e) {
					console.error(e);
					failureCt += 1;
				}
			}

			if (failureCt === installedDirectories.length) {
				throw new Error('Failed to remove all directories');
			}
		}

		await addonStorage.removeAsync(addon);
		if (typeof addon.id === 'string') this.addonRemoved.emit(addon.id);

		if (removeDependencies) await this.#removeDependencies(addon);
	}

	async #removeDependencies(addon: Addon): Promise<void> {
		for (const dependency of addon.dependencies ?? []) {
			if (!dependency.externalAddonId) {
				console.warn('No external addon id for dependency', dependency);
				continue;
			}
			if (!addon.providerName || !addon.installationId) {
				console.warn('Invalid addon for dependency', addon);
				continue;
			}

			const dependencyAddon = await this.getByExternalId(
				dependency.externalAddonId,
				addon.providerName,
				addon.installationId
			);

			if (!dependencyAddon) {
				console.log(`${addon.name}: Dependency not found ${dependency.externalAddonId}`);
				continue;
			}

			await this.removeAddon(dependencyAddon);
		}
	}

	async setProvider(
		addon: Addon | undefined,
		externalId: string,
		providerName: string,
		installation: WowInstallation
	): Promise<void> {
		if (addon === undefined) throw new Error('Invalid addon');

		const provider = addonProviders.getProvider(providerName);
		if (!provider) throw new Error(`Provider not found: ${providerName}`);

		if (await this.isInstalled(externalId, providerName, installation)) {
			throw new Error(ERROR_ADDON_ALREADY_INSTALLED);
		}

		const externalAddon = await this.getAddon(externalId, providerName, installation);
		if (!externalAddon) {
			throw new Error(`External addon not found: ${providerName}|${externalId}`);
		}

		await this.saveAddon(externalAddon);
		if (!externalAddon.id) throw new Error('External addon had no id');

		await this.installAddon(externalAddon, undefined, addon);
		await this.removeAddon(addon, false, false);
	}

	setProviderEnabled(providerName: string, enabled: boolean): void {
		const provider = addonProviders.getProvider(providerName);
		if (provider) provider.enabled = enabled;
	}

	// ---- sync ----------------------------------------------------------------------

	async syncAllClients(): Promise<void> {
		console.debug('syncAllClients');
		this.syncing = true;

		const installations = await warcraftInstallations.getWowInstallationsAsync();

		try {
			await this.#syncBatchProviders(installations);
			await this.#syncStandardProviders(installations);
		} catch (e) {
			console.error(e);
		} finally {
			this.syncing = false;
			this.addonAction.emit({ type: 'sync' });
		}
	}

	async syncClient(installation: WowInstallation): Promise<void> {
		console.debug('syncClient', installation.displayName);
		await this.#syncBatchProviders([installation]);
		try {
			await this.#syncStandardProviders([installation]);
		} catch (e) {
			console.error(e);
		}
	}

	/** External IDs, dropping empty or undefined values. */
	#getExternalIds = (addons: Addon[]): string[] =>
		addons.map((addon) => addon.externalId).filter((id): id is string => !!id);

	/** Combine external IDs across all installs into one request per batch-capable provider. */
	async #syncBatchProviders(installations: WowInstallation[]): Promise<void> {
		console.debug('syncBatchProviders');

		for (const provider of addonProviders.getBatchAddonProviders()) {
			try {
				const allAddons = await addonStorage.getAllForProviderAsync(provider.name);
				if (allAddons.length === 0) continue;

				const batchedAddons = allAddons.filter((addon) => addon.isIgnored === false);
				const addonIds = this.#getExternalIds(batchedAddons);
				const results = await provider.getAllBatch(installations, addonIds);

				for (const key of Object.keys(results.errors)) {
					const errors = results.errors[key];
					if (errors.length === 0) continue;

					const installation = installations.find((i) => i.id === key);
					const installationAddons = batchedAddons.filter((addon) => addon.installationId === key);
					await this.#handleSyncErrors(installation, errors, provider, installationAddons);
				}

				for (const key of Object.keys(results.installationResults)) {
					const addonSearchResults = results.installationResults[key];
					if (addonSearchResults.length === 0) continue;

					const installation = installations.find((i) => i.id === key);
					const installationAddons = batchedAddons.filter((addon) => addon.installationId === key);
					await this.#handleSyncResults(addonSearchResults, installationAddons, installation);
				}
			} catch (e) {
				console.error(e);
			}
		}
	}

	async #syncStandardProviders(installations: WowInstallation[]): Promise<boolean> {
		console.info('syncStandardProviders');
		let didSync = true;

		for (const provider of addonProviders.getStandardAddonProviders()) {
			for (const installation of installations) {
				const addons = await addonStorage.getAllForInstallationIdAsync(installation.id);
				const validAddons = addons.filter((addon) => addon.isIgnored === false);

				try {
					await this.#syncProviderAddons(installation, validAddons, provider);
				} catch (e) {
					console.error(`Failed to sync from provider: ${provider.name}`, e);
					this.syncError.emit(
						new AddonSyncError({
							providerName: provider.name,
							installationName: installation.displayName,
							innerError: e as Error
						})
					);
					didSync = false;
				}
			}
		}

		await this.#refreshUpdatesAvailable();
		return didSync;
	}

	async #syncProviderAddons(
		installation: WowInstallation,
		addons: Addon[],
		addonProvider: AddonProvider
	): Promise<void> {
		const providerAddonIds = this.#getExternalIdsForProvider(addonProvider, addons);
		if (!providerAddonIds.length) return;

		const getAllResult = await addonProvider.getAll(installation, providerAddonIds);
		await this.#handleSyncErrors(installation, getAllResult.errors, addonProvider, addons);
		await this.#handleSyncResults(getAllResult.searchResults, addons, installation);
	}

	async #handleSyncResults(
		addonSearchResults: AddonSearchResult[],
		addons: Addon[],
		installation: WowInstallation | undefined
	): Promise<void> {
		for (const result of addonSearchResults) {
			const addon = addons.find((a) => this.addonMatchesSearchResult(a, result));
			if (!addon) continue;

			try {
				const latestFile = searchResults.getLatestFile(result, addon.channelType);
				if (!latestFile) {
					console.warn(`No latest file found: ${addon.name}, clientType: ${addon.clientType}`);
					addon.warningType = AddonWarningType.NoProviderFiles;
					await addonStorage.setAsync(addon.id, addon);

					this.syncError.emit(
						new AddonSyncError({
							providerName: addon.providerName ?? '',
							installationName: installation?.displayName ?? '',
							addonName: addon.name
						})
					);
					continue;
				}

				await this.#setExternalIdString(addon);

				addon.summary = result.summary;
				addon.thumbnailUrl = result.thumbnailUrl;
				addon.latestChangelog = latestFile.changelog || addon.latestChangelog;

				if (
					addon.warningType &&
					[AddonWarningType.MissingOnProvider, AddonWarningType.NoProviderFiles].includes(
						addon.warningType
					)
				) {
					addon.warningType = undefined;
				}

				addon.screenshotUrls = result.screenshotUrls;

				if (
					strIsNotNullOrEmpty(latestFile.downloadUrl) &&
					latestFile.downloadUrl !== addon.downloadUrl
				) {
					addon.downloadUrl = latestFile.downloadUrl || addon.downloadUrl;
				}

				if (Array.isArray(result.fundingLinks)) addon.fundingLinks = result.fundingLinks;

				// Nothing new to record — the release id or version/date are unchanged.
				if (!!latestFile.externalId && latestFile.externalId === addon.externalLatestReleaseId) {
					continue;
				}
				if (
					latestFile.version === addon.latestVersion &&
					latestFile.releaseDate === addon.releasedAt
				) {
					continue;
				}

				addon.latestVersion = latestFile.version;
				addon.releasedAt = latestFile.releaseDate;
				addon.externalLatestReleaseId = latestFile.externalId;
				addon.name = result.name;
				addon.author = result.author;
				addon.externalChannel = getEnumName(AddonChannelType, latestFile.channelType);

				if (latestFile.gameVersion) {
					addon.gameVersion = getGameVersionList([latestFile.gameVersion]);
				} else if (addon.gameVersion) {
					addon.gameVersion = getGameVersionList(addon.gameVersion ?? []);
				} else {
					console.warn('No game version found', addon);
				}

				addon.externalUrl = result.externalUrl;
			} finally {
				await addonStorage.setAsync(addon.id, addon);
			}
		}
	}

	async #handleSyncErrors(
		installation: WowInstallation | undefined,
		errors: Error[],
		addonProvider: AddonProvider,
		addons: Addon[]
	): Promise<void> {
		for (const error of errors) {
			const addonId = (error as { addonId?: string }).addonId;
			let addon: Addon | undefined;

			if (addonId) {
				addon = addons.find(
					(a) => a.externalId === addonId && a.providerName === addonProvider.name
				);
			}

			if (error instanceof GenericProviderError && addon !== undefined) {
				addon.warningType = error.warningType;
				if (addon.id) await addonStorage.setAsync(addon.id, addon);
			}

			this.syncError.emit(
				new AddonSyncError({
					providerName: addonProvider.name,
					installationName: installation?.displayName ?? '',
					innerError: error,
					addonName: addon?.name
				})
			);
		}
	}

	/** Legacy TukUI/ElvUI ids were ints; normalise them to strings. */
	async #setExternalIdString(addon: Addon): Promise<void> {
		if (!addon.id) return;
		if (typeof addon.externalId === 'string') return;

		addon.externalId = String(addon.externalId);
		await addonStorage.setAsync(addon.id, addon);
	}

	#getExternalIdsForProvider = (addonProvider: AddonProvider, addons: Addon[]): string[] =>
		addons
			.filter((addon) => addon.providerName === addonProvider.name)
			.map((f) => f.externalId)
			.filter((id): id is string => typeof id === 'string');

	// ---- scanning --------------------------------------------------------------------

	async rescanInstallation(installation: WowInstallation): Promise<Addon[]> {
		if (!installation) return [];

		console.debug(`[addon-service] rescanInstallation: ${installation.displayName}`);
		let addons = await addonStorage.getAllForInstallationIdAsync(installation.id);

		const newAddons = await this.#scanAddons(installation, addons);
		await addonStorage.removeAllForInstallationAsync(installation.id);

		addons = this.#updateAddons(addons, newAddons);
		await addonStorage.saveAll(addons);

		this.addonAction.emit({ type: 'scan' });
		await this.#refreshUpdatesAvailable();

		return addons;
	}

	#updateAddons(existingAddons: Addon[], newAddons: Addon[]): Addon[] {
		for (const newAddon of newAddons) {
			const existingAddon = existingAddons.find(
				(ea) =>
					ea.externalId?.toString() === newAddon.externalId?.toString() &&
					ea.providerName == newAddon.providerName
			);
			if (!existingAddon) continue;

			newAddon.autoUpdateEnabled = existingAddon.autoUpdateEnabled;
			newAddon.isIgnored = existingAddon.isIgnored;
			newAddon.installedAt = existingAddon.installedAt;
			newAddon.channelType = Math.max(existingAddon.channelType, newAddon.channelType);
		}
		return newAddons;
	}

	async #removeGitFolders(addonFolders: AddonFolder[]): Promise<void> {
		for (const addonFolder of addonFolders) {
			const directories = await files.listDirectories(addonFolder.path);
			if (directories.find((dir) => dir.toLowerCase() === '.git')) {
				addonFolder.ignoreReason = 'git_repo';
			}
		}
	}

	/**
	 * Drop folders belonging to addons whose provider cannot be re-scanned (GitHub addons
	 * have no toc-discoverable id), and keep those addons as-is.
	 */
	#removeNonRescanFolders(addonFolders: AddonFolder[], currentAddons: Addon[]): Addon[] {
		const remainingAddons: Addon[] = [];
		const removedAddonFolders: AddonFolder[] = [];

		for (const currentAddon of currentAddons) {
			const provider = addonProviders.getProvider(currentAddon.providerName ?? '');
			if (provider === undefined || provider.allowReScan === true) continue;

			removedAddonFolders.push(
				..._.remove(addonFolders, (af) =>
					(currentAddon.installedFolderList ?? []).includes(af.name)
				)
			);
			remainingAddons.push(currentAddon);
		}

		console.log(
			`Removed ${removedAddonFolders.length} NonRescan folders: ${removedAddonFolders.map((af) => af.name).join(', ')}`
		);
		console.log(
			`Kept ${remainingAddons.length} NonRescan addons: ${remainingAddons.map((ad) => ad.name).join(', ')}`
		);

		return remainingAddons;
	}

	async #scanAddons(installation: WowInstallation, currentAddons?: Addon[]): Promise<Addon[]> {
		const addonList: Addon[] = [];
		if (!installation) return [];

		this.scanUpdate = { type: ScanUpdateType.Start };

		try {
			const defaultAddonChannel = installation.defaultAddonChannelType;
			const useSymlinkMode = await wowup.getUseSymlinkMode();
			const addonFolders = await warcraft.listAddons(installation, useSymlinkMode);

			if (addonFolders.length === 0) return [];

			await this.#removeGitFolders(addonFolders);

			if (Array.isArray(currentAddons)) {
				addonList.push(...this.#removeNonRescanFolders(addonFolders, currentAddons));
			}

			await getFingerprints(addonFolders);

			this.scanUpdate = {
				type: ScanUpdateType.Update,
				currentCount: 0,
				totalCount: addonFolders.length
			};

			for (const provider of addonProviders.getEnabledAddonProviders()) {
				try {
					const validFolders = addonFolders.filter(
						(af) => !af.ignoreReason && !af.matchingAddon && af.tocs.length > 0
					);
					await provider.scan(installation, defaultAddonChannel, validFolders);
				} catch (e) {
					console.error('scan failed: ' + provider.name);
					console.error(e);
					this.scanError.emit(
						new AddonScanError({ providerName: provider.name, innerError: e as Error })
					);
				}
			}

			const matchedAddonFolders = addonFolders.filter((af) => !!af.matchingAddon);
			const matchedAddonFolderNames = matchedAddonFolders.map((mf) => mf.name);

			for (const maf of matchedAddonFolders) {
				if (maf.matchingAddon === undefined) {
					console.warn('matching adding undefined');
					continue;
				}

				const targetToc = tocService.getTocForGameType2(
					maf.name,
					maf.tocs,
					installation.clientType
				);
				if (targetToc === undefined) {
					console.warn('toc file undefined', maf, installation.clientType);
					continue;
				}

				if (!targetToc.fileName.startsWith(maf.name)) {
					console.warn('TOC NAME MISMATCH', maf.name, targetToc.fileName);
					maf.matchingAddon.warningType = AddonWarningType.TocNameMismatch;
				}

				this.#setExternalIds(maf.matchingAddon, targetToc);
			}

			// One addon can span several folders; keep the folder with the richest metadata.
			const matchedGroups = _.groupBy(
				matchedAddonFolders,
				(addonFolder) =>
					`${addonFolder.matchingAddon?.providerName ?? ''}${addonFolder.matchingAddon?.externalId ?? ''}`
			);

			for (const value of Object.values(matchedGroups)) {
				const ordered = _.sortBy(value, (v) => v.matchingAddon?.externalIds?.length ?? 0).reverse();
				if (ordered[0]?.matchingAddon) addonList.push(ordered[0].matchingAddon);
			}

			const unmatchedFolders = addonFolders.filter((af) =>
				this.#isAddonFolderUnmatched(matchedAddonFolderNames, af, installation)
			);

			for (const uf of unmatchedFolders) {
				addonList.push(await this.#createUnmatchedAddon(uf, installation, matchedAddonFolderNames));
			}

			// Changelogs are per-release and will not always be current after a rescan.
			for (const addon of addonList) {
				if (!addon) continue;
				addon.latestChangelog = undefined;
				addon.latestChangelogVersion = undefined;
				addon.channelType = installation.defaultAddonChannelType;
			}

			return addonList;
		} finally {
			this.scanUpdate = { type: ScanUpdateType.Complete };
		}
	}

	/**
	 * A folder with no provider match may still be a sub-folder of a matched TukUI or
	 * WowInterface addon, in which case it is not really unmatched.
	 */
	#isAddonFolderUnmatched(
		matchedFolderNames: string[],
		addonFolder: AddonFolder,
		installation: WowInstallation
	): boolean {
		if (addonFolder.matchingAddon) return false;

		const targetToc = tocService.getTocForGameType2(
			addonFolder.name,
			addonFolder.tocs,
			installation.clientType
		);

		// A load-on-demand addon 'should' be a sub folder of something already matched.
		const isLoadOnDemand = targetToc?.loadOnDemand === '1';
		if (isLoadOnDemand && _.difference(targetToc.dependencyList, matchedFolderNames).length === 0) {
			return false;
		}

		return true;
	}

	// ---- external ids -----------------------------------------------------------------

	#setExternalIds(addon: Addon, toc: Toc): void {
		if (!toc) return;

		const externalIds: AddonExternalId[] = [];
		for (const [key, value] of Object.entries(ADDON_PROVIDER_TOC_EXTERNAL_ID_MAP)) {
			this.insertExternalId(externalIds, key, toc[value] as string);
		}

		if (!this.containsOwnExternalId(addon, externalIds)) {
			if (!addon.providerName || !addon.externalId) return;
			this.insertExternalId(externalIds, addon.providerName, addon.externalId);
		}

		addon.externalIds = externalIds;
	}

	insertExternalId(externalIds: AddonExternalId[], providerName: string, addonId?: string): void {
		if (
			!addonId ||
			[ADDON_PROVIDER_RAIDERIO, ADDON_PROVIDER_WOWUP_COMPANION].includes(providerName)
		) {
			return;
		}

		const exists =
			externalIds.findIndex(
				(extId) => extId.id === addonId && extId.providerName === providerName
			) !== -1;

		if (exists) {
			console.debug(`External id exists ${providerName}|${addonId}`);
			return;
		}

		if (addonProviders.getProvider(providerName)?.isValidAddonId(addonId) ?? false) {
			externalIds.push({ id: addonId, providerName });
		} else {
			console.warn(`Invalid provider id ${providerName}|${addonId}`);
			console.warn(externalIds);
		}
	}

	containsOwnExternalId = (addon: Addon, array?: AddonExternalId[]): boolean => {
		const arr = array || addon.externalIds;
		return (
			Array.isArray(arr) &&
			!!arr.find((ext) => ext.id === addon.externalId && ext.providerName === addon.providerName)
		);
	};

	async getTocPaths(addon: Addon): Promise<string[]> {
		if (!addon.installationId) return [];

		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (!installation) return [];

		const addonTocs = await tocService.getAllTocs(
			warcraft.getAddonFolderPath(installation),
			addon.installedFolderList ?? [],
			installation.clientType
		);

		return addonTocs.map((toc) => toc.filePath);
	}

	async backfillAddon(addon: Addon): Promise<void> {
		if (addon.externalIds && this.containsOwnExternalId(addon)) return;

		try {
			const tocPaths = await this.getTocPaths(addon);
			const tocFiles = await Promise.all(tocPaths.map((tocPath) => tocService.parse(tocPath)));

			// Was _.orderBy(tocFiles, ["wowInterfaceId", "loadOnDemand"], ["desc", "asc"]).
			const orderedTocFiles = [...tocFiles].sort(
				(a, b) =>
					String(b.wowInterfaceId ?? '').localeCompare(String(a.wowInterfaceId ?? '')) ||
					String(a.loadOnDemand ?? '').localeCompare(String(b.loadOnDemand ?? ''))
			);

			const primaryToc = orderedTocFiles[0];
			if (!primaryToc) throw new Error('Could not find primary toc');

			this.#setExternalIds(addon, primaryToc);
			await this.saveAddon(addon);
		} catch (e) {
			console.error(e);
		}
	}

	async backfillAddons(): Promise<void> {
		const installations = await warcraftInstallations.getWowInstallationsAsync();

		for (const installation of installations) {
			const addons = await addonStorage.getAllForInstallationIdAsync(installation.id);
			for (const addon of addons) {
				await this.backfillAddon(addon);
				await this.#backfillAddonInstalledFolderList(addon);
			}
		}
	}

	async #backfillAddonInstalledFolderList(addon: Addon): Promise<void> {
		if (addon.installedFolderList) return;
		addon.installedFolderList = addon.installedFolders?.split(',') ?? [];
		await this.saveAddon(addon);
	}

	// ---- migrations --------------------------------------------------------------------

	async migrateDeep(installation: WowInstallation): Promise<void> {
		await this.#migrateLocalAddons(installation);

		console.log(`[MigrateInstall] ${installation.displayName}`);
		const existingAddons = await this.getAllAddons(installation);
		if (!existingAddons.length) {
			console.log(`[MigrateInstall] ${installation.displayName} no addons found`);
			return;
		}

		if (!existingAddons.some((addon) => this.#needsMigration(addon))) {
			console.log(`[MigrateInstall] ${installation.displayName} No addons needed to be migrated`);
			return;
		}

		const scannedAddons = await this.#scanAddons(installation);
		for (const addon of existingAddons) {
			await this.#migrateSyncAddon(addon, scannedAddons);
		}
	}

	async #migrateLocalAddons(installation: WowInstallation): Promise<void> {
		const existingAddons = await this.getAllAddons(installation);
		if (!existingAddons.length) {
			console.log(`[MigrateInstall] ${installation.displayName} no addons found`);
			return;
		}

		if (!existingAddons.some((addon) => this.#needsMigration(addon))) {
			console.log(`[MigrateInstall] ${installation.displayName} No addons needed to be migrated`);
			return;
		}

		let migratedCt = 0;
		for (const addon of existingAddons) {
			if (await this.#migrateLocalAddon(addon)) migratedCt += 1;
		}

		console.log(
			`[MigrateInstall] Local addons complete: [${migratedCt}] ${installation.displayName}`
		);
	}

	#needsMigration(addon: Addon): boolean {
		const provider = addonProviders.getProvider(addon.providerName ?? '');

		return (
			typeof addon.gameVersion === 'string' ||
			addon.providerName === ADDON_PROVIDER_HUB_LEGACY ||
			typeof addon.autoUpdateNotificationsEnabled === 'undefined' ||
			!addon.installedFolderList ||
			!addon.externalChannel ||
			(provider?.shouldMigrate(addon) ?? false)
		);
	}

	async #migrateLocalAddon(addon: Addon): Promise<boolean> {
		let changed = false;

		if (typeof addon.gameVersion === 'string') {
			console.log(`[MigrateAddon] '${addon.name}' Updating gameVersion array`);
			addon.gameVersion = [addon.gameVersion];
			changed = true;
		}

		if (typeof addon.autoUpdateNotificationsEnabled === 'undefined') {
			console.log(`[MigrateAddon] '${addon.name}' Updating autoUpdateNotificationsEnabled`);
			addon.autoUpdateNotificationsEnabled = addon.autoUpdateEnabled;
			changed = true;
		}

		if (addon.providerName === ADDON_PROVIDER_HUB_LEGACY) {
			console.log(`[MigrateAddon] '${addon.name}' Updating legacy hub name`);
			addon.providerName = ADDON_PROVIDER_HUB;
			changed = true;
		}

		if (changed) await this.saveAddon(addon);
		return changed;
	}

	async #migrateSyncAddon(addon: Addon, scannedAddons: Addon[]): Promise<void> {
		const scannedAddon = scannedAddons.find(
			(sa) => sa.externalId === addon.externalId && addon.providerName === sa.providerName
		);

		if (!scannedAddon) {
			console.log(`[MigrateAddon] '${addon.name}' No scanned addon found`);
			return;
		}

		addon.installedExternalReleaseId = scannedAddon.externalLatestReleaseId;
		addon.externalChannel = scannedAddon.externalChannel;

		if (!addon.installedFolderList) {
			addon.installedFolderList = scannedAddon.installedFolderList;
		}

		await this.saveAddon(addon);
	}

	/** Drop addons whose WoW installation no longer exists. */
	async reconcileOrphanAddons(installations: WowInstallation[]): Promise<void> {
		const addons = await addonStorage.getAll();

		for (const addon of addons) {
			if (!addon.installationId) {
				console.debug(
					`Removing detached legacy addon [${getEnumName(WowClientType, addon.clientType)}]: ${addon.name}`
				);
				await this.removeAddon(addon, false, false);
				continue;
			}

			if (installations.find((installation) => installation.id === addon.installationId)) continue;

			console.debug(
				`Removing orphaned addon [${getEnumName(WowClientType, addon.clientType)}]: ${addon.name}`
			);
			await this.removeAddon(addon, false, false);
		}
	}

	async setInstallationAutoUpdate(installation: WowInstallation): Promise<void> {
		const addons = await addonStorage.getAllForInstallationIdAsync(installation.id);
		if (addons.length === 0) {
			console.log(`No addons were found to set auto update: ${installation.location}`);
			return;
		}

		console.log(
			`Setting ${addons.length} addons to auto update: ${installation.defaultAutoUpdate.toString()}`
		);

		for (const addon of addons) addon.autoUpdateEnabled = installation.defaultAutoUpdate;

		await addonStorage.saveAll(addons);
		console.log('Auto update set complete');
	}

	// ---- paths / persistence -------------------------------------------------------------

	async saveAddon(addon: Addon | undefined): Promise<void> {
		if (!addon) throw new Error('Invalid addon');
		await addonStorage.setAsync(addon.id, addon);
	}

	getInstallBasePath = (addon: Addon): string =>
		warcraft.getAddonFolderPath(this.#getWowInstallation(addon));

	getFullInstallPath(addon: Addon): string {
		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (!installation) throw new Error(`installation not found: ${addon.installationId ?? ''}`);
		return join(warcraft.getAddonFolderPath(installation), addon.installedFolderList?.[0] ?? '');
	}

	#getWowInstallation(addon: Addon): WowInstallation {
		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (installation === undefined) {
			throw new Error(`installation not found: ${addon.installationId ?? ''}`);
		}
		return installation;
	}

	#getAddonProvider(addon: Addon): AddonProvider {
		const addonProvider = addonProviders.getProvider(addon.providerName ?? '');
		if (addonProvider === undefined) {
			throw new Error(`Provider not found: ${addon.providerName ?? ''}`);
		}
		return addonProvider as AddonProvider;
	}

	// ---- addon construction ----------------------------------------------------------------

	#createAddonDependency = (dependency: AddonSearchResultDependency): AddonDependency => ({
		externalAddonId: dependency.externalAddonId,
		type: dependency.type
	});

	#createAddon(
		searchResult: AddonSearchResult,
		latestFile: AddonSearchResultFile | undefined,
		installation: WowInstallation
	): Addon | undefined {
		if (!latestFile) return undefined;

		return {
			id: crypto.randomUUID(),
			name: searchResult.name,
			thumbnailUrl: searchResult.thumbnailUrl,
			latestVersion: latestFile.version,
			clientType: installation.clientType,
			externalId: searchResult.externalId.toString(),
			gameVersion: getGameVersionList([latestFile.gameVersion]),
			author: searchResult.author,
			downloadUrl: latestFile.downloadUrl,
			externalUrl: searchResult.externalUrl,
			providerName: searchResult.providerName,
			channelType: installation.defaultAddonChannelType,
			isIgnored: false,
			autoUpdateEnabled: installation.defaultAutoUpdate,
			autoUpdateNotificationsEnabled: installation.defaultAutoUpdate,
			releasedAt: latestFile.releaseDate,
			summary: searchResult.summary,
			screenshotUrls: searchResult.screenshotUrls,
			dependencies: Array.isArray(latestFile.dependencies)
				? latestFile.dependencies.map(this.#createAddonDependency)
				: [],
			externalChannel: getEnumName(AddonChannelType, latestFile.channelType),
			isLoadOnDemand: false,
			externalLatestReleaseId: latestFile.externalId,
			fundingLinks: Array.isArray(searchResult.fundingLinks) ? [...searchResult.fundingLinks] : [],
			latestChangelog: latestFile.changelog,
			latestChangelogVersion: latestFile.version,
			installationId: installation.id,
			installedFolderList: []
		};
	}

	#hasValidTocTitle = (toc: Toc | undefined): boolean =>
		!!toc?.title && /[a-zA-Z]/g.test(toc.title);

	async #createUnmatchedAddon(
		addonFolder: AddonFolder,
		installation: WowInstallation,
		matchedAddonFolderNames: string[]
	): Promise<Addon> {
		const targetToc = tocService.getTocForGameType2(
			addonFolder.name,
			addonFolder.tocs,
			installation.clientType
		);
		const tocMissingDependencies = _.difference(targetToc?.dependencyList, matchedAddonFolderNames);
		const lastUpdatedAt = await files.getLatestDirUpdateTime(addonFolder.path);

		return {
			id: crypto.randomUUID(),
			name: this.#hasValidTocTitle(targetToc)
				? (targetToc?.title ?? addonFolder.name)
				: addonFolder.name,
			thumbnailUrl: '',
			latestVersion: targetToc?.version || '',
			installedVersion: targetToc?.version || '',
			clientType: installation.clientType,
			externalId: '',
			gameVersion: getGameVersionList(targetToc?.interface ?? []),
			author: targetToc?.author || '',
			downloadUrl: '',
			externalUrl: '',
			providerName: ADDON_PROVIDER_UNKNOWN,
			channelType: AddonChannelType.Stable,
			isIgnored: true,
			autoUpdateEnabled: false,
			autoUpdateNotificationsEnabled: false,
			releasedAt: new Date(lastUpdatedAt),
			installedAt: addonFolder.fileStats?.mtime || new Date(),
			installedFolders: addonFolder.name,
			installedFolderList: [addonFolder.name],
			summary: '',
			screenshotUrls: [],
			isLoadOnDemand: targetToc?.loadOnDemand === '1',
			externalChannel: getEnumName(AddonChannelType, AddonChannelType.Stable),
			missingDependencies: tocMissingDependencies,
			ignoreReason: addonFolder.ignoreReason,
			installationId: installation.id
		};
	}

	// ---- debug ---------------------------------------------------------------------------

	async logDebugData(): Promise<void> {
		const curseProvider = addonProviders.getProvider<CurseAddonProvider>(ADDON_PROVIDER_CURSEFORGE);
		const hubProvider = addonProviders.getProvider<WowUpAddonProvider>(ADDON_PROVIDER_HUB);

		if (curseProvider === undefined) throw new Error('curse provider not found');
		if (hubProvider === undefined) throw new Error('hub provider not found');

		const clientMap: Record<
			string,
			{ curse: Record<string, string>; hub: Record<string, string> }
		> = {};
		const installations = await warcraftInstallations.getWowInstallationsAsync();

		for (const installation of installations) {
			const clientTypeName = getEnumName(WowClientType, installation.clientType);

			const useSymlinkMode = await wowup.getUseSymlinkMode();
			const addonFolders = await warcraft.listAddons(installation, useSymlinkMode);
			await getFingerprints(addonFolders);

			const curseMap: Record<string, string> = {};
			const hubMap: Record<string, string> = {};

			for (const af of addonFolders) {
				if (af.cfScanResults !== undefined) {
					curseMap[af.cfScanResults.folderName] = af.cfScanResults.fingerprint;
				}
				if (af.wowUpScanResults !== undefined) {
					hubMap[af.wowUpScanResults.folderName] = af.wowUpScanResults.fingerprint;
				}
			}

			clientMap[clientTypeName] = { curse: curseMap, hub: hubMap };
			console.log(`clientType ${clientTypeName} addon fingerprints`);
		}

		console.log(JSON.stringify(clientMap));
	}
}

export const addonService = new AddonService();

// The Angular AddonService re-exported these from AddonInstallService; keep that surface.
export const onAddonInstalled = addonInstall.onAddonInstalled.bind(addonInstall);
export const onInstallError = addonInstall.onInstallError.bind(addonInstall);
