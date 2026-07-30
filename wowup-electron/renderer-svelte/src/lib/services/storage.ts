// Port of src/app/services/storage/{storage,preference-storage,sensitive-storage}.service.ts.
//
// Angular used an abstract base class + two @Injectable subclasses whose entire body was a
// `storageName` field and a super() call — a class hierarchy to work around DI. Here it is
// one factory called twice.

import {
	IPC_STORE_GET_OBJECT,
	IPC_STORE_GET_OBJECT_SYNC,
	IPC_STORE_SET_OBJECT,
	PREFERENCE_STORE_NAME,
	SENSITIVE_STORE_NAME,
	TRUE_STR
} from '$common/constants';
import { invoke, sendSync } from '$lib/ipc';

export interface StorageChangeEvent<T = unknown> {
	key: string;
	value: T;
}

export interface Storage {
	readonly change: (fn: (e: StorageChangeEvent) => void) => () => void;
	getBool(key: string): Promise<boolean>;
	getAsync<T = string>(key: string): Promise<T>;
	getSync<T = string>(key: string): T;
	setAsync(key: string, value: unknown): Promise<void>;
	getObjectAsync<T>(key: string): Promise<T | undefined>;
}

function createStorage(storageName: string): Storage {
	const listeners = new Set<(e: StorageChangeEvent) => void>();

	return {
		change(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		async getBool(key) {
			return (await this.getAsync(key)) === TRUE_STR;
		},

		getAsync<T = string>(key: string) {
			return invoke<T>(IPC_STORE_GET_OBJECT, storageName, key);
		},

		getSync<T = string>(key: string) {
			return sendSync<T>(IPC_STORE_GET_OBJECT_SYNC, storageName, key);
		},

		async setAsync(key, value) {
			try {
				await invoke(IPC_STORE_SET_OBJECT, storageName, key, value);
				for (const fn of listeners) fn({ key, value });
			} catch (e) {
				console.error(`setAsync failed: ${key}`);
				throw e;
			}
		},

		getObjectAsync<T>(key: string) {
			return invoke<T | undefined>(IPC_STORE_GET_OBJECT, storageName, key);
		}
	};
}

export const preferenceStorage = createStorage(PREFERENCE_STORE_NAME);
export const sensitiveStorage = createStorage(SENSITIVE_STORE_NAME);
