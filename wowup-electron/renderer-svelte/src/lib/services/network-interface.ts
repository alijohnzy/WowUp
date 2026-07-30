// Port of src/app/business-objects/generic-network-interface.ts (33 LOC).
//
// Implements wowup-lib-core's NetworkInterface so the library-provided providers
// (WowUpAddonProvider, WowInterfaceAddonProvider, TukUiAddonProvider) can make HTTP calls
// without knowing anything about the host app.

import type { GetConfig, NetworkInterface, PostConfig } from 'wowup-lib-core';
import { memCache } from '$lib/services/caching';
import type { CircuitBreakerWrapper } from '$lib/services/network';

export class GenericNetworkInterface implements NetworkInterface {
	constructor(private readonly _circuitBreaker: CircuitBreakerWrapper) {}

	async getJson<T>(url: string | URL, config?: GetConfig): Promise<T> {
		return await memCache.transaction(
			url.toString(),
			() =>
				this._circuitBreaker.getJson<T>(
					url,
					config?.headers as Record<string, string>,
					config?.timeoutMs
				),
			30
		);
	}

	async getText(url: string | URL, config?: GetConfig): Promise<string> {
		return await memCache.transaction(
			url.toString(),
			() => this._circuitBreaker.getText(url, config?.timeoutMs),
			30
		);
	}

	async postJson<T>(url: string | URL, config: PostConfig): Promise<T> {
		if (config.cache === true) {
			const key = `${url.toString()}-${JSON.stringify(config.body).length.toString()}`;
			return await memCache.transaction(
				key,
				() =>
					this._circuitBreaker.postJson<T>(
						url,
						config.body,
						config.headers as Record<string, string>,
						config.timeoutMs
					),
				30
			);
		}

		return await this._circuitBreaker.postJson<T>(
			url,
			config.body,
			config.headers as Record<string, string>,
			config.timeoutMs
		);
	}
}
