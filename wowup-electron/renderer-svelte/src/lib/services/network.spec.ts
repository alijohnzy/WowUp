// The request timeout must be cancellable.
//
// `AbortSignal.timeout()` cannot be cleared — it fires at the deadline whether or not the
// request finished. plugin-http listens for that abort and cancels the request in Rust, but
// by then the response resource has been freed, so every successful call produced
// "The resource id … is invalid" about ten seconds later. Unhandled, because nothing awaits
// a request that already returned.
//
// Measured: reverting to AbortSignal.timeout reproduces two of those per launch; with the
// cancellable timer there are none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('$lib/http', () => ({ httpFetch: (...a: unknown[]) => fetchMock(...a) }));
vi.mock('$config/environment', () => ({
	AppConfig: { defaultHttpTimeoutMs: 10_000, defaultHttpResetTimeoutMs: 30_000 }
}));

import { getCircuitBreaker, getJson } from './network';

/** The AbortSignal the last call was given. */
const lastSignal = (): AbortSignal => fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('request timeout', () => {
	it('leaves no timer pending once the response has been read', async () => {
		fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

		await getJson('https://api.example.test/thing', 10_000);

		// The timer count, not the signal's state: `AbortSignal.timeout` is a platform timer
		// that fake timers do not drive, so a reverted implementation would look inert here
		// rather than fail. What this can catch — and the likeliest regression — is dropping
		// the `finally { clearTimeout }`, which leaves the abort armed after completion.
		//
		// The definitive check is `npm run tauri:verify:boot`: reverting to
		// AbortSignal.timeout produces two "resource id … is invalid" rejections per launch,
		// and the cancellable timer produces none.
		expect(vi.getTimerCount()).toBe(0);
		expect(lastSignal().aborted).toBe(false);
	});

	it('still aborts a request that never comes back', async () => {
		fetchMock.mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				})
		);

		const pending = getJson('https://api.example.test/hang', 10_000);
		const assertion = expect(pending).rejects.toThrow(/Timed out after 10000ms/);
		await vi.advanceTimersByTimeAsync(10_001);
		await assertion;
	});

	it('clears the timer even when the request fails', async () => {
		fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));

		await expect(getJson('https://api.example.test/bad', 10_000)).rejects.toThrow(/HTTP 500/);
		const signal = lastSignal();

		await vi.advanceTimersByTimeAsync(60_000);

		expect(signal.aborted).toBe(false);
	});
});

// A breaker that never recovers.
//
// Callers ask `isOpen()` before calling `fire()`, so once the breaker trips, that gate is the
// only thing deciding whether opossum ever gets another request. Opossum closes a breaker by
// seeing a call succeed — so if the gate keeps rejecting through the half-open window, the
// breaker stays open forever and `resetTimeout` does nothing.
//
// Wago hid this: it calls `close()` by hand on every API key from the ad frame, and the frame
// reloaded every five minutes. Collapsing the empty ad slot stopped the reloads and turned a
// self-healing 30-second blip into "restart the app", which is how it was found.
describe('circuit breaker recovery', () => {
	const failing = () => Promise.reject(new Error('boom'));

	it('reopens the gate once the reset timeout has passed', async () => {
		const cb = getCircuitBreaker('test_recovery', 30_000, 10_000);

		// opossum's default volume threshold is 10 calls before it will trip.
		for (let i = 0; i < 12; i++) await cb.fire(failing).catch(() => undefined);
		expect(cb.isOpen()).toBe(true);

		await vi.advanceTimersByTimeAsync(30_001);

		// Half-open: opossum is waiting for exactly one probe, so the gate must let it through.
		expect(cb.isOpen()).toBe(false);
	});

	it('closes for good once a probe succeeds', async () => {
		const cb = getCircuitBreaker('test_probe', 30_000, 10_000);

		for (let i = 0; i < 12; i++) await cb.fire(failing).catch(() => undefined);
		await vi.advanceTimersByTimeAsync(30_001);
		await cb.fire(() => Promise.resolve('ok'));

		expect(cb.isOpen()).toBe(false);
	});
});
