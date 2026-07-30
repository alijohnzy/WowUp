// Port of src/app/services/files/file.service.ts (197 LOC).
//
// Every method was a one-line IPC forward wrapped in @Injectable + constructor DI.
// Stripping the Angular scaffolding leaves plain exported functions. `uuid` is gone —
// crypto.randomUUID() is native in Chromium 150 (Electron 43).

import {
	DEFAULT_FILE_MODE,
	IPC_COPY_FILE_CHANNEL,
	IPC_CREATE_DIRECTORY_CHANNEL,
	IPC_DELETE_DIRECTORY_CHANNEL,
	IPC_GET_ASSET_FILE_PATH,
	IPC_GET_DIRECTORY_TREE,
	IPC_GET_HOME_DIR,
	IPC_GET_LATEST_DIR_UPDATE_TIME,
	IPC_LIST_DIRECTORIES_CHANNEL,
	IPC_LIST_DIR_RECURSIVE,
	IPC_LIST_ENTRIES,
	IPC_LIST_FILES_CHANNEL,
	IPC_PATH_EXISTS_CHANNEL,
	IPC_READDIR,
	IPC_READ_FILE_BUFFER_CHANNEL,
	IPC_READ_FILE_CHANNEL,
	IPC_SHOW_DIRECTORY,
	IPC_STAT_FILES_CHANNEL,
	IPC_UNZIP_FILE_CHANNEL,
	IPC_WRITE_FILE_CHANNEL
} from '$common/constants';
import type { FsDirent, TreeNode } from '$common/models/ipc-events';
import type { GetDirectoryTreeOptions } from '$common/models/ipc-request';
import type { ZipEntry } from '$common/models/ipc-response';
import { invoke } from '$lib/ipc';
import type { FsStats } from 'wowup-lib-core';

export const getHomeDir = (): Promise<string> => invoke(IPC_GET_HOME_DIR);
export const getAssetFilePath = (fileName: string): Promise<string> =>
	invoke(IPC_GET_ASSET_FILE_PATH, fileName);
export const createDirectory = (directoryPath: string): Promise<boolean> =>
	invoke(IPC_CREATE_DIRECTORY_CHANNEL, directoryPath);
export const showDirectory = (sourceDir: string): Promise<string> =>
	invoke(IPC_SHOW_DIRECTORY, sourceDir);
export const pathExists = (sourcePath: string): Promise<boolean> =>
	invoke(IPC_PATH_EXISTS_CHANNEL, sourcePath);

/** Delete a file or directory. */
export function remove(sourcePath: string): Promise<boolean> {
	if (!sourcePath) throw new Error('remove sourcePath required');
	return invoke(IPC_DELETE_DIRECTORY_CHANNEL, sourcePath);
}

export async function removeAll(...sourcePaths: string[]): Promise<boolean> {
	if (!Array.isArray(sourcePaths) || !sourcePaths.length) return false;
	const results = await Promise.all(
		sourcePaths.map((sp) => {
			console.log(`[RemovePath]: ${sp}`);
			return invoke<boolean>(IPC_DELETE_DIRECTORY_CHANNEL, sp);
		})
	);
	return results.every((r) => r === true);
}

export async function removeAllSafe(...sourcePaths: string[]): Promise<boolean> {
	try {
		return await removeAll(...sourcePaths);
	} catch (e) {
		console.error('Failed to remove all', sourcePaths, e);
		return false;
	}
}

/** Copy a file or folder. Returns the destination path. */
export async function copy(
	sourceFilePath: string,
	destinationFilePath: string,
	destinationFileChmod: string | number = DEFAULT_FILE_MODE
): Promise<string> {
	await invoke(IPC_COPY_FILE_CHANNEL, {
		sourceFilePath,
		destinationFilePath,
		destinationFileChmod,
		responseKey: crypto.randomUUID()
	});
	return destinationFilePath;
}

export async function deleteIfExists(filePath: string): Promise<void> {
	if (await pathExists(filePath)) await remove(filePath);
}

export const readFile = (sourcePath: string): Promise<string> =>
	invoke(IPC_READ_FILE_CHANNEL, sourcePath);
export const readFileBuffer = (sourcePath: string): Promise<Buffer> =>
	invoke(IPC_READ_FILE_BUFFER_CHANNEL, sourcePath);
export const writeFile = (sourcePath: string, contents: string): Promise<string> =>
	invoke(IPC_WRITE_FILE_CHANNEL, sourcePath, contents);

/** Time in ms of the most recently updated file in a folder. */
export const getLatestDirUpdateTime = (dirPath: string): Promise<number> =>
	invoke(IPC_GET_LATEST_DIR_UPDATE_TIME, dirPath);

export const listDirectoryRecursive = (dirPath: string): Promise<string[]> =>
	invoke(IPC_LIST_DIR_RECURSIVE, dirPath);
export const getDirectoryTree = (
	dirPath: string,
	opts?: GetDirectoryTreeOptions
): Promise<TreeNode> => invoke(IPC_GET_DIRECTORY_TREE, { dirPath, opts });
export const listDirectories = (sourcePath: string, scanSymlinks = false): Promise<string[]> =>
	invoke(IPC_LIST_DIRECTORIES_CHANNEL, sourcePath, scanSymlinks);
export const readdir = (dirPath: string): Promise<string[]> => invoke(IPC_READDIR, dirPath);
export const statFiles = (filePaths: string[]): Promise<Record<string, FsStats>> =>
	invoke(IPC_STAT_FILES_CHANNEL, filePaths);
export const listEntries = (sourcePath: string, filter: string): Promise<FsDirent[]> =>
	invoke(IPC_LIST_ENTRIES, sourcePath, filter);
export const listFiles = (sourcePath: string, filter: string): Promise<string[]> =>
	invoke(IPC_LIST_FILES_CHANNEL, sourcePath, filter);

export const listZipFiles = (sourcePath: string, filter: string): Promise<ZipEntry[]> =>
	invoke('zip-list-files', sourcePath, filter);
export const readFileInZip = (zipPath: string, filePath: string): Promise<string> =>
	invoke('zip-read-file', zipPath, filePath);

export function unzipFile(zipFilePath: string, outputFolder: string): Promise<string> {
	console.log('unzipFile', zipFilePath);
	return invoke(IPC_UNZIP_FILE_CHANNEL, {
		outputFolder,
		zipFilePath,
		responseKey: crypto.randomUUID()
	});
}

export const zipFile = (srcPath: string, destPath: string): Promise<void> =>
	invoke('zip-file', srcPath, destPath);
export const renameFile = (srcPath: string, destPath: string): Promise<void> =>
	invoke('rename-file', srcPath, destPath);
