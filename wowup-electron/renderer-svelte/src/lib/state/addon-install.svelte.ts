// Port of src/app/services/addons/addon-install.service.ts (695 LOC).
//
// Removed: @Injectable + 9-service DI, 4 Subjects, `nanoid`, Node `path`, and 12 lodash calls.
//
// The install queue was `Subject.pipe(mergeMap(fn, 3)).subscribe()` — an unbounded queue
// draining three at a time. That is reproduced explicitly below, because the concurrency
// limit is load-bearing (it caps simultaneous downloads and unzips) and burying it in an
// operator chain made that easy to miss.

import {
	ADDON_PROVIDER_RAIDERIO,
	ADDON_PROVIDER_TUKUI,
	ADDON_PROVIDER_UNKNOWN,
	ADDON_PROVIDER_WAGO,
	ADDON_PROVIDER_WOWINTERFACE,
	ADDON_PROVIDER_WOWUP_COMPANION,
	ADDON_PROVIDER_ZIP,
	USER_ACTION_ADDON_INSTALL
} from '$common/constants';
import slug from 'slug';
import {
	getEnumName,
	getGameVersionList,
	WowClientType,
	type Addon,
	type AddonExternalId,
	type Toc,
	type WowInstallation
} from 'wowup-lib-core';
import { AddonInstallState } from '$lib/models/addon-install-state';
import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
import * as _ from '$lib/utils/collection';
import { capitalizeString } from '$lib/utils/string';
import { join } from '$lib/utils/path';
import * as addonStorage from '$lib/services/addon-storage';
import * as files from '$lib/services/files';
import * as tocService from '$lib/services/toc';
import { downloadZipFile, type DownloadOptions } from '$lib/services/download';
import { trackAction } from '$lib/services/analytics';
import { addonProviders } from '$lib/state/addon-providers.svelte';
import { warcraft } from '$lib/state/warcraft.svelte';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
import { wowup } from '$lib/state/wowup.svelte';

export type InstallType = 'install' | 'update' | 'remove';

export interface InstallQueueItem {
	addon: Addon;
	onUpdate?: (installState: AddonInstallState, progress: number) => void | Promise<void>;
	completion: { resolve: () => void; reject: (e: unknown) => void };
	originalAddon?: Addon;
	installType: InstallType;
}

const IGNORED_FOLDER_NAMES = ['__MACOSX'];
const MAX_CONCURRENT_INSTALLS = 3;
const MAX_DOWNLOAD_RETRIES = 3;

const ADDON_PROVIDER_TOC_EXTERNAL_ID_MAP: Record<string, keyof Toc> = {
	[ADDON_PROVIDER_WOWINTERFACE]: 'wowInterfaceId',
	[ADDON_PROVIDER_TUKUI]: 'tukUiProjectId',
	[ADDON_PROVIDER_WAGO]: 'wagoAddonId'
};

type Listener<T> = (value: T) => void;

class AddonInstall {
	#queue: InstallQueueItem[] = [];
	#running = 0;

	#installedListeners = new Set<Listener<AddonUpdateEvent>>();
	#errorListeners = new Set<Listener<Error>>();
	#removedListeners = new Set<Listener<string>>();

	onAddonInstalled(fn: Listener<AddonUpdateEvent>): () => void {
		this.#installedListeners.add(fn);
		return () => this.#installedListeners.delete(fn);
	}

	onInstallError(fn: Listener<Error>): () => void {
		this.#errorListeners.add(fn);
		return () => this.#errorListeners.delete(fn);
	}

	onAddonRemoved(fn: Listener<string>): () => void {
		this.#removedListeners.add(fn);
		return () => this.#removedListeners.delete(fn);
	}

	#emitInstalled(evt: AddonUpdateEvent): void {
		for (const fn of this.#installedListeners) fn(evt);
	}

	// ---- queue -------------------------------------------------------------------

	enqueue(queueItem: InstallQueueItem): void {
		this.#queue.push(queueItem);
		this.#pump();
	}

	/** Drains the queue at MAX_CONCURRENT_INSTALLS. Was rxjs mergeMap's concurrency arg. */
	#pump(): void {
		while (this.#running < MAX_CONCURRENT_INSTALLS && this.#queue.length > 0) {
			const item = this.#queue.shift()!;
			this.#running++;

			void this.#processInstallQueue(item)
				.then((addonName) => console.log('Install complete', addonName))
				.catch((error: unknown) => {
					console.error(error);
					for (const fn of this.#errorListeners) fn(error as Error);
				})
				.finally(() => {
					this.#running--;
					this.#pump();
				});
		}
	}

	async #processInstallQueue(queueItem: InstallQueueItem): Promise<string> {
		const { addon, onUpdate } = queueItem;

		this.#logAddonAction(
			`Addon${capitalizeString(queueItem.installType)}`,
			addon,
			`'${addon.installedVersion ?? ''}' -> '${addon.latestVersion ?? ''}'`
		);

		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (!installation) throw new Error(`Installation not found: ${addon.installationId ?? ''}`);

		const addonProvider = addonProviders.getProvider(addon.providerName ?? '');
		if (!addonProvider) throw new Error(`Addon provider not found: ${addon.providerName ?? ''}`);

		const downloadFileName = `${slug(addon.name)}.zip`;

		const report = async (installState: AddonInstallState, progress: number) => {
			await onUpdate?.(installState, progress);
			this.#emitInstalled({ addon, installState, progress });
		};

		await report(AddonInstallState.Downloading, 25);

		let downloadedFilePath = '';
		let unzippedDirectory = '';

		try {
			const downloadAuth = await addonProvider.getDownloadAuth();
			console.debug(`Download auth for ${addon.name}:`, downloadAuth);

			let retryCt = 0;
			while (downloadedFilePath.length === 0) {
				const downloadOptions: DownloadOptions = {
					fileName: downloadFileName,
					outputFolder: wowup.applicationDownloadsFolderPath,
					url: addon.downloadUrl ?? '',
					auth: downloadAuth
				};

				try {
					downloadedFilePath = await downloadZipFile(downloadOptions);
				} catch (e) {
					if (retryCt === MAX_DOWNLOAD_RETRIES) throw e;
					retryCt += 1;
					console.log(`install download failed, retry ${retryCt}`);
					await report(AddonInstallState.Retry, 0);
				}
			}

			await report(AddonInstallState.BackingUp, 50);
			const directoriesToBeRemoved = await this.#backupOriginalDirectories(addon);

			await report(AddonInstallState.Installing, 75);
			const unzipPath = join(wowup.applicationDownloadsFolderPath, crypto.randomUUID());

			try {
				unzippedDirectory = await files.unzipFile(downloadedFilePath, unzipPath);
				await this.#installUnzippedDirectory(unzippedDirectory, installation);
			} catch (err) {
				console.error(err);
				this.#logAddonAction('RestoreBackup', addon, ...directoriesToBeRemoved);
				await this.#restoreAddonDirectories(directoriesToBeRemoved);
				throw err;
			} finally {
				await files.removeAllSafe(...directoriesToBeRemoved);
			}

			const unzippedDirectoryNames = await files.listDirectories(unzippedDirectory);
			_.remove(unzippedDirectoryNames, (dirName) => IGNORED_FOLDER_NAMES.includes(dirName));

			const existingDirectoryNames = addon.installedFolderList ?? [];
			const addedDirectoryNames = _.difference(unzippedDirectoryNames, existingDirectoryNames);
			const removedDirectoryNames = _.difference(existingDirectoryNames, unzippedDirectoryNames);

			if (existingDirectoryNames.length > 0) {
				this.#logAddonAction('AddedDirs', addon, ...addedDirectoryNames);
			}
			if (removedDirectoryNames.length > 0) {
				this.#logAddonAction('DiffDirs', addon, ...removedDirectoryNames);
			}

			addon.installedExternalReleaseId = addon.externalLatestReleaseId;
			addon.installedVersion = addon.latestVersion;
			addon.installedAt = new Date();
			addon.installedFolderList = unzippedDirectoryNames;
			addon.installedFolders = unzippedDirectoryNames.join(',');
			addon.isIgnored = addonProvider.forceIgnore;

			const allTocFiles = await tocService.getAllTocs(
				unzippedDirectory,
				unzippedDirectoryNames,
				addon.clientType
			);

			const gameVersions = this.#getLatestGameVersions(allTocFiles);
			if (gameVersions.length > 0) addon.gameVersion = gameVersions;

			if (!addon.author) addon.author = this.#getBestGuessAuthor(allTocFiles);

			// Zip-file addons have no provider metadata, so the toc is the only name source.
			if (addonProvider.name === ADDON_PROVIDER_ZIP) {
				addon.name = this.#getBestGuessTitle(allTocFiles);
			}

			await addonStorage.setAsync(addon.id, addon);
			this.#trackInstallAction(queueItem.installType, addon);
			await this.backfillAddon(addon);

			if (queueItem.originalAddon) {
				await this.#reconcileExternalIds(addon, queueItem.originalAddon);
			}
			await this.#reconcileAddonFolders(addon);

			queueItem.completion.resolve();
			await report(AddonInstallState.Complete, 100);

			this.#logAddonAction(
				`Addon${capitalizeString(queueItem.installType)}Complete`,
				addon,
				addon.installedVersion ?? ''
			);
		} catch (err) {
			console.error(err);
			queueItem.completion.reject(err);
			await report(AddonInstallState.Error, 100);
		} finally {
			if (unzippedDirectory && (await files.pathExists(unzippedDirectory))) {
				await files.remove(unzippedDirectory);
			}
			if (downloadedFilePath && (await files.pathExists(downloadedFilePath))) {
				await files.remove(downloadedFilePath);
			}
		}

		return addon.name;
	}

	// ---- filesystem --------------------------------------------------------------

	#logAddonAction(action: string, addon: Addon, ...extras: string[]): void {
		console.log(
			`[${action}] ${addon.providerName ?? ''} ${addon.externalId ?? 'NO_EXT_ID'} ${addon.name} ${extras.join(' ')}`
		);
	}

	async #backupOriginalDirectories(addon: Addon): Promise<string[]> {
		const installedFolders = addon.installedFolderList ?? [];
		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (!installation) return [];

		const addonFolderPath = warcraft.getAddonFolderPath(installation);
		const backupFolders: string[] = [];

		for (const addonFolder of installedFolders) {
			const currentAddonLocation = join(addonFolderPath, addonFolder);
			const addonFolderBackupLocation = join(addonFolderPath, `${addonFolder}-bak`);

			await files.deleteIfExists(addonFolderBackupLocation);

			if (await files.pathExists(currentAddonLocation)) {
				await files.createDirectory(addonFolderBackupLocation);
				// Copy rather than rename — a rename would break open file handles.
				await files.copy(currentAddonLocation, addonFolderBackupLocation);
				await files.remove(currentAddonLocation);
				backupFolders.push(addonFolderBackupLocation);
			}
		}

		return backupFolders;
	}

	async #installUnzippedDirectory(
		unzippedDirectory: string,
		installation: WowInstallation
	): Promise<void> {
		const addonFolderPath = warcraft.getAddonFolderPath(installation);
		const unzippedFolders = await files.listDirectories(unzippedDirectory);

		for (const unzippedFolder of unzippedFolders) {
			if (IGNORED_FOLDER_NAMES.includes(unzippedFolder)) continue;

			const unzippedFilePath = join(unzippedDirectory, unzippedFolder);
			const unzipLocation = join(addonFolderPath, unzippedFolder);

			try {
				await files.copy(unzippedFilePath, unzipLocation);
			} catch (err) {
				console.error(`Failed to copy addon directory ${unzipLocation}`);
				throw err;
			}
		}
	}

	async #restoreAddonDirectories(directories: string[]): Promise<void> {
		try {
			for (const directory of directories) {
				// Strip the "-bak" suffix added by backupOriginalDirectories.
				const originalLocation = directory.substring(0, directory.length - 4);

				if (await files.pathExists(directory)) {
					if (await files.pathExists(originalLocation)) {
						await files.remove(originalLocation);
					}
					await files.copy(directory, originalLocation);
				}
			}
		} catch (e) {
			console.error('Failed to roll back directories', directories, e);
		}
	}

	// ---- toc-derived metadata ------------------------------------------------------

	#getLatestGameVersions(tocs: Toc[]): string[] {
		return getGameVersionList(tocs.flatMap((toc) => toc.interface ?? []));
	}

	#getBestGuessTitle(tocs: Toc[]): string {
		const titles = tocs.map((toc) => toc.title).filter((title): title is string => !!title);
		return _.maxBy(titles, (title) => title.length) ?? '';
	}

	#getBestGuessAuthor(tocs: Toc[]): string | undefined {
		const authors = tocs.map((toc) => toc.author).filter((author): author is string => !!author);
		return _.maxBy(authors, (author) => author.length);
	}

	#trackInstallAction(installType: InstallType, addon: Addon): void {
		trackAction(USER_ACTION_ADDON_INSTALL, {
			clientType: getEnumName(WowClientType, addon.clientType),
			provider: addon.providerName,
			addon: addon.name,
			addonId: addon.externalId,
			installType
		});
	}

	// ---- external ids ---------------------------------------------------------------

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

	containsOwnExternalId(addon: Addon, array?: AddonExternalId[]): boolean {
		const arr = array || addon.externalIds;
		return (
			Array.isArray(arr) &&
			!!arr.find((ext) => ext.id === addon.externalId && ext.providerName === addon.providerName)
		);
	}

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

	#setExternalIds(addon: Addon, toc: Toc): void {
		if (!toc) return;

		const externalIds: AddonExternalId[] = [];
		for (const [key, value] of Object.entries(ADDON_PROVIDER_TOC_EXTERNAL_ID_MAP)) {
			this.insertExternalId(externalIds, key, toc[value] as string);
		}

		// If the addon's own provider id is not represented, add it.
		if (!this.containsOwnExternalId(addon, externalIds)) {
			if (!addon.providerName || !addon.externalId) return;
			this.insertExternalId(externalIds, addon.providerName, addon.externalId);
		}

		addon.externalIds = externalIds;
	}

	async #reconcileExternalIds(newAddon: Addon, oldAddon: Addon): Promise<void> {
		if (!newAddon || !oldAddon) return;

		// Carry previously known external ids across a provider swap — the same addon does
		// not always have matching ids between providers.
		oldAddon.externalIds?.forEach((oldExtId) => {
			const match = newAddon.externalIds?.find(
				(newExtId) => newExtId.id === oldExtId.id && newExtId.providerName === oldExtId.providerName
			);
			if (match) return;
			console.log(`Reconciling external id: ${oldExtId.providerName}|${oldExtId.id}`);
			newAddon.externalIds?.push({ ...oldExtId });
		});

		// Drop ids that are no longer valid for their provider.
		_.remove(
			newAddon.externalIds ?? [],
			(extId) => !addonProviders.getProvider(extId.providerName)?.isValidAddonId(extId.id)
		);

		await this.saveAddon(newAddon);
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

	// ---- storage / removal ------------------------------------------------------------

	async saveAddon(addon: Addon | undefined): Promise<void> {
		if (!addon) throw new Error('Invalid addon');
		await addonStorage.setAsync(addon.id, addon);
	}

	getAddons = (installation: WowInstallation): Promise<Addon[]> =>
		addonStorage.getAllForInstallationIdAsync(installation.id);

	async #reconcileAddonFolders(addon: Addon): Promise<void> {
		if (!addon.installationId) {
			console.warn('addon installation id missing', addon);
			return;
		}

		const installation = warcraftInstallations.getWowInstallation(addon.installationId);
		if (!installation) {
			console.warn('addon installation not found', addon.installationId);
			return;
		}

		const existingAddons = (await this.getAddons(installation)).filter(
			(ea) =>
				ea.id !== addon.id &&
				_.intersection(addon.installedFolderList, ea.installedFolderList).length > 0
		);

		for (const existingAddon of existingAddons) {
			if (existingAddon.providerName === ADDON_PROVIDER_UNKNOWN) {
				await this.removeAddon(existingAddon, false, false);
			}
		}
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

		if (typeof addon.id === 'string') {
			for (const fn of this.#removedListeners) fn(addon.id);
		}

		if (removeDependencies) await this.#removeDependencies(addon);

		this.#trackInstallAction('remove', addon);
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

	getByExternalId = (
		externalId: string,
		providerName: string,
		installationId: string
	): Promise<Addon | undefined> =>
		addonStorage.getByExternalIdAsync(externalId, providerName, installationId);
}

export const addonInstall = new AddonInstall();
