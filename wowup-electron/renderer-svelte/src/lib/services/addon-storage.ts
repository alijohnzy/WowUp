// Port of src/app/services/storage/addon-storage.service.ts (87 LOC).

import {
	ADDON_STORE_NAME,
	IPC_ADDONS_GET_ALL,
	IPC_ADDONS_GET_ALL_FOR_INSTALLATION,
	IPC_ADDONS_GET_ALL_FOR_PROVIDER,
	IPC_ADDONS_GET_AUTO_UPDATE_ENABLED,
	IPC_ADDONS_GET_AVAILABLE_FOR_UPDATE,
	IPC_ADDONS_GET_BY_EXTERNAL_ID,
	IPC_ADDONS_GET_BY_EXTERNAL_IDS,
	IPC_ADDONS_SAVE_ALL,
	IPC_STORE_GET_OBJECT,
	IPC_STORE_REMOVE_OBJECT,
	IPC_STORE_SET_OBJECT
} from '$common/constants';
import { invoke } from '$lib/ipc';
import type { Addon } from 'wowup-lib-core';

export function saveAll(addons: Addon[]): Promise<void> {
	console.debug(`[addon-storage] save all: ${addons?.length ?? 0}`);
	return invoke(IPC_ADDONS_SAVE_ALL, addons);
}

export function setAsync(key: string | undefined, value: Addon): Promise<void> {
	if (!key) return Promise.resolve();
	return invoke(IPC_STORE_SET_OBJECT, ADDON_STORE_NAME, key, value);
}

export const get = (key: string): Promise<Addon> =>
	invoke(IPC_STORE_GET_OBJECT, ADDON_STORE_NAME, key);

export async function removeAsync(addon: Addon): Promise<void> {
	if (addon.id) await invoke(IPC_STORE_REMOVE_OBJECT, ADDON_STORE_NAME, addon.id);
}

export async function removeAllAsync(...addons: Addon[]): Promise<void> {
	for (const addon of addons) await removeAsync(addon);
}

export async function removeAllForInstallationAsync(installationId: string): Promise<void> {
	await removeAllAsync(...(await getAllForInstallationIdAsync(installationId)));
}

export const getAll = (): Promise<Addon[]> => invoke(IPC_ADDONS_GET_ALL);
export const getAllForInstallationIdAsync = (installationId: string): Promise<Addon[]> =>
	invoke(IPC_ADDONS_GET_ALL_FOR_INSTALLATION, installationId);
export const getAllForProviderAsync = (providerName: string): Promise<Addon[]> =>
	invoke(IPC_ADDONS_GET_ALL_FOR_PROVIDER, providerName);
export const getByExternalIdAsync = (
	externalId: string,
	providerName: string,
	installationId: string
): Promise<Addon | undefined> =>
	invoke(IPC_ADDONS_GET_BY_EXTERNAL_ID, externalId, providerName, installationId);
export const getByExternalIds = (externalIds: string[]): Promise<Addon[]> =>
	invoke(IPC_ADDONS_GET_BY_EXTERNAL_IDS, externalIds);
export const getAvailableForUpdate = (installationId?: string): Promise<Addon[]> =>
	invoke(IPC_ADDONS_GET_AVAILABLE_FOR_UPDATE, installationId);
export const getAutoUpdateEnabled = (): Promise<Addon[]> =>
	invoke(IPC_ADDONS_GET_AUTO_UPDATE_ENABLED);
