// Port of src/app/services/wowup-api/wowup-api.service.ts (46 LOC).

import { AppConfig } from '$config/environment';
import { getCircuitBreaker, type CircuitBreakerWrapper } from './network';
import type { WowUpGetAccountResponse } from 'wowup-lib-core';

const API_URL = AppConfig.wowUpApiUrl;

let breaker: CircuitBreakerWrapper | undefined;
function cb(): CircuitBreakerWrapper {
	// Lazily created: the Angular version built it in a constructor that ran at DI time.
	breaker ??= getCircuitBreaker('WowUpApiService_main');
	return breaker;
}

const authHeader = (token: string): Record<string, string> => ({
	Authorization: `Bearer ${token}`
});

export function getAccount(authToken: string): Promise<WowUpGetAccountResponse> {
	return cb().getJson<WowUpGetAccountResponse>(
		new URL(`${API_URL}/account`),
		authHeader(authToken),
		5000
	);
}

export function registerPushToken(
	authToken: string,
	pushToken: string,
	deviceType: string
): Promise<unknown> {
	const url = new URL(`${API_URL}/account/push`);
	url.searchParams.set('push_token', pushToken);
	url.searchParams.set('os', deviceType);
	return cb().postJson<unknown>(url, {}, authHeader(authToken));
}

export function removePushToken(authToken: string, pushToken: string): Promise<unknown> {
	return cb().deleteJson<unknown>(
		new URL(`${API_URL}/account/push/${pushToken}`),
		authHeader(authToken)
	);
}
