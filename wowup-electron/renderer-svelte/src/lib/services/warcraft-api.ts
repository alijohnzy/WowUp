// Port of src/app/services/api/warcraft-api.service.ts (44 LOC).
//
// This is already the target shape of the UI-decoupling plan: a thin wrapper over IPC
// channels served by app/controllers/warcraft/. Nothing here but the Angular removal.

import {
	IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH,
	IPC_WARCRAFT_GET_CLIENT_TYPE_FOR_BINARY,
	IPC_WARCRAFT_GET_EXECUTABLE_EXTENSION,
	IPC_WARCRAFT_GET_EXECUTABLE_NAME,
	IPC_WARCRAFT_GET_INSTALLED_PRODUCTS,
	IPC_WARCRAFT_IS_WOW_APPLICATION
} from '$common/constants';
import { invoke } from '$lib/ipc';
import type { InstalledProduct, WowClientType } from 'wowup-lib-core';

export const getBlizzardAgentPath = (): Promise<string> =>
	invoke(IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH);

/**
 * Electron's IPC uses structured clone, so the main process's `Map` arrives as a `Map`.
 * Tauri's is JSON, where a `Map` would arrive as `{}` — and since the only consumer calls
 * `.get()`, every lookup would return undefined and the app would report no WoW installed
 * rather than throwing.
 *
 * The Rust command therefore returns `[[clientType, product], …]`. `new Map()` accepts both
 * that and an existing `Map` (it copies), so this one wrapper is correct on both backends.
 */
export const getInstalledProducts = async (
	agentPath: string
): Promise<Map<WowClientType, InstalledProduct>> =>
	new Map(
		await invoke<Iterable<[WowClientType, InstalledProduct]>>(
			IPC_WARCRAFT_GET_INSTALLED_PRODUCTS,
			agentPath
		)
	);
export const getExecutableName = (clientType: WowClientType): Promise<string> =>
	invoke(IPC_WARCRAFT_GET_EXECUTABLE_NAME, clientType);
export const getClientTypeForBinary = (binaryPath: string): Promise<WowClientType> =>
	invoke(IPC_WARCRAFT_GET_CLIENT_TYPE_FOR_BINARY, binaryPath);
export const isWowApplication = (appName: string): Promise<boolean> =>
	invoke(IPC_WARCRAFT_IS_WOW_APPLICATION, appName);
export const getExecutableExtension = (): Promise<string> =>
	invoke(IPC_WARCRAFT_GET_EXECUTABLE_EXTENSION);
