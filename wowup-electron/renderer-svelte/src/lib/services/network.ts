// Port of src/app/services/network/network.service.ts (182 LOC).
//
// This is the one place the "HttpClient -> fetch" swap genuinely applies:
//   @angular/common/http HttpClient      -> fetch
//   rxjs firstValueFrom/first/timeout    -> AbortSignal.timeout() (Chromium 103+)
// `opossum` stays — a circuit breaker is framework-agnostic and there is no built-in for it.

import CircuitBreaker from 'opossum';
import { AppConfig } from '$config/environment';

const CACHE_CONTROL_HEADERS: Record<string, string> = {
	'Cache-Control': 'no-cache',
	Pragma: 'no-cache'
};

/**
 * Replaces @angular/common/http HttpErrorResponse.
 * Carries `headers` because the GitHub provider reads its rate-limit headers off the error.
 */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		readonly headers: Headers = new Headers()
	) {
		super(`HTTP ${status} for ${url}`);
		this.name = 'HttpError';
	}
}

async function request<T>(
	url: URL | string,
	init: RequestInit,
	timeoutMs: number,
	parse: 'json' | 'text'
): Promise<T> {
	const res = await fetch(url.toString(), {
		...init,
		signal: AbortSignal.timeout(timeoutMs)
	});

	if (!res.ok) throw new HttpError(res.status, url.toString(), res.headers);
	return parse === 'json' ? ((await res.json()) as T) : ((await res.text()) as T);
}

export class CircuitBreakerWrapper {
	readonly #cb: CircuitBreaker;
	readonly #defaultTimeoutMs: number;
	#state: 'open' | 'closed' = 'closed';

	constructor(
		name: string,
		resetTimeoutMs = AppConfig.defaultHttpResetTimeoutMs,
		httpTimeoutMs = AppConfig.defaultHttpTimeoutMs
	) {
		this.#defaultTimeoutMs = httpTimeoutMs;
		this.#cb = new CircuitBreaker((action: () => Promise<unknown>) => action(), {
			timeout: httpTimeoutMs,
			resetTimeout: resetTimeoutMs,
			// Don't trip the breaker on a 404.
			errorFilter: (err: unknown) => (err as HttpError)?.status === 404
		});
		this.#cb.on('open', () => {
			console.log(`${name} circuit breaker open`);
			this.#state = 'open';
		});
		this.#cb.on('close', () => {
			console.log(`${name} circuit breaker close`);
			this.#state = 'closed';
		});
	}

	isOpen = (): boolean => this.#state === 'open';
	enable = (): void => this.#cb.enable();
	close = (): void => this.#cb.close();

	async fire<T>(action: () => Promise<T>): Promise<T> {
		return (await this.#cb.fire(action)) as T;
	}

	getJson<T>(url: URL | string, headers: Record<string, string> = {}, timeoutMs?: number) {
		return this.fire(() =>
			request<T>(
				url,
				{ headers: { ...CACHE_CONTROL_HEADERS, ...headers } },
				timeoutMs ?? this.#defaultTimeoutMs,
				'json'
			)
		);
	}

	getText(url: URL | string, timeoutMs?: number) {
		return this.fire(() =>
			request<string>(
				url,
				{ headers: { ...CACHE_CONTROL_HEADERS } },
				timeoutMs ?? this.#defaultTimeoutMs,
				'text'
			)
		);
	}

	postJson<T>(
		url: URL | string,
		body: unknown,
		headers: Record<string, string> = {},
		timeoutMs?: number
	) {
		return this.fire(() =>
			request<T>(
				url,
				{
					method: 'POST',
					body: JSON.stringify(body),
					headers: { 'Content-Type': 'application/json', ...headers }
				},
				timeoutMs ?? this.#defaultTimeoutMs,
				'json'
			)
		);
	}

	deleteJson<T>(url: URL | string, headers: Record<string, string> = {}, timeoutMs?: number) {
		return this.fire(() =>
			request<T>(
				url,
				{ method: 'DELETE', headers: { ...headers } },
				timeoutMs ?? this.#defaultTimeoutMs,
				'json'
			)
		);
	}
}

export function getCircuitBreaker(
	name: string,
	resetTimeoutMs: number = AppConfig.defaultHttpResetTimeoutMs,
	httpTimeoutMs: number = AppConfig.defaultHttpTimeoutMs
): CircuitBreakerWrapper {
	console.debug('Create circuit breaker', name, resetTimeoutMs, httpTimeoutMs);
	return new CircuitBreakerWrapper(name, resetTimeoutMs, httpTimeoutMs);
}

export const getJson = <T>(url: URL | string, timeoutMs?: number): Promise<T> =>
	request<T>(
		url,
		{ headers: { ...CACHE_CONTROL_HEADERS } },
		timeoutMs ?? AppConfig.defaultHttpTimeoutMs,
		'json'
	);

export const getText = (url: URL | string, timeoutMs?: number): Promise<string> =>
	request<string>(
		url,
		{ headers: { ...CACHE_CONTROL_HEADERS } },
		timeoutMs ?? AppConfig.defaultHttpTimeoutMs,
		'text'
	);
