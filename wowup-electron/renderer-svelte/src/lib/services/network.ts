// Port of src/app/services/network/network.service.ts (182 LOC).
//
// This is the one place the "HttpClient -> fetch" swap genuinely applies:
//   @angular/common/http HttpClient      -> fetch
//   rxjs firstValueFrom/first/timeout    -> AbortSignal.timeout() (Chromium 103+)
// `opossum` stays — a circuit breaker is framework-agnostic and there is no built-in for it.

import CircuitBreaker from 'opossum';
import { AppConfig } from '$config/environment';
import { httpFetch } from '$lib/http';

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
	// A cancellable timer, not `AbortSignal.timeout()`.
	//
	// `AbortSignal.timeout` cannot be cleared: it fires at `timeoutMs` whether or not the
	// request finished. Under Electron a post-completion abort is inert, but plugin-http
	// registers an abort listener that cancels the request in Rust — and by then its response
	// resource has been freed, so it rejected with "The resource id 3697265254 is invalid"
	// roughly ten seconds after each successful call. Unhandled, because nothing is awaiting
	// a request that already returned, and untraceable, because Tauri rejects commands with a
	// bare string: no stack, no URL.
	//
	// Clearing the timer in `finally` means the signal can only fire while the request is
	// genuinely outstanding.
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, 'TimeoutError')),
		timeoutMs
	);

	try {
		// httpFetch, not fetch: under Tauri this has to leave the webview to escape CORS.
		const res = await httpFetch(url.toString(), { ...init, signal: controller.signal });

		if (!res.ok) throw new HttpError(res.status, url.toString(), res.headers);

		try {
			return parse === 'json' ? ((await res.json()) as T) : ((await res.text()) as T);
		} catch (e) {
			// The body is read through a second command against a resource handle, so it can
			// fail after the request itself succeeded — and that rejection carries no URL either.
			const detail = e instanceof Error ? e.message : String(e);
			throw new Error(`Reading ${parse} body of ${url.toString()} failed: ${detail}`, {
				cause: e
			});
		}
	} finally {
		clearTimeout(timer);
	}
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
			// The request already carries `AbortSignal.timeout(timeoutMs)`, and opossum's own
			// timer at the same duration made two. Opossum's does not cancel anything — it
			// rejects the outer promise and leaves the request running — so whichever fired
			// first left the other's rejection unobserved. Under Tauri that surfaced as
			// "Unhandled rejection: The resource id … is invalid" during addon sync: the signal
			// aborted, plugin-http dropped the response, and the abandoned body read rejected
			// into nothing.
			//
			// The signal is the one that actually aborts, so it is the one kept. A timed-out
			// request still rejects and still counts toward the breaker.
			timeout: false,
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
