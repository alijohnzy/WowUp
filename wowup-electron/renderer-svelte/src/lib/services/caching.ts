// Port of src/app/services/caching/caching-service.ts (33 LOC) and
// src/app/business-objects/mem-cache.ts (25 LOC) — which were the same node-cache wrapper
// written twice, as an @Injectable and as a module, backing two separate cache instances.
//
// Drops `node-cache` (6.3 KB in the Angular bundle, and a Node library running in a browser
// context only because nodeIntegration is on). The whole surface used is get/set/transaction
// with a TTL.

interface Entry<T> {
	value: T;
	expiresAt: number;
}

export interface Cache {
	get<T>(key: string): T | undefined;
	set<T>(key: string, value: T, ttlSec?: number): boolean;
	transaction<T>(key: string, missingAction: () => Promise<T>, ttlSec?: number): Promise<T>;
	clear(): void;
}

export function createCache(): Cache {
	const entries = new Map<string, Entry<unknown>>();

	const cache: Cache = {
		get<T>(key: string): T | undefined {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (entry.expiresAt <= Date.now()) {
				entries.delete(key);
				return undefined;
			}
			return entry.value as T;
		},

		set<T>(key: string, value: T, ttlSec = 600): boolean {
			entries.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
			return true;
		},

		/** Return the cached value, or run `missingAction`, cache its result, and return that. */
		async transaction<T>(key: string, missingAction: () => Promise<T>, ttlSec = 600): Promise<T> {
			const cached = cache.get<T>(key);
			if (cached !== undefined && cached !== null) return cached;

			const result = await missingAction();
			if (result !== undefined && result !== null) cache.set(key, result, ttlSec);
			return result;
		},

		clear(): void {
			entries.clear();
		}
	};

	return cache;
}

/** Was CachingService — injected into the addon providers. */
const defaultCache = createCache();

export const get = defaultCache.get;
export const set = defaultCache.set;
export const transaction = defaultCache.transaction;
export const clear = defaultCache.clear;

/** Was business-objects/mem-cache.ts — a separate instance used by the network interfaces. */
export const memCache = createCache();
