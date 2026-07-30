// Ports of src/app/utils/{time,array,number}.utils.ts.
// src/app/utils/dom.utils.ts is not ported — nothing imports it, and the Angular build
// already warns that it is part of the compilation but unused.

export const delayMs = (timeMs: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, timeMs));

/**
 * Map with a concurrency cap, preserving input order.
 * Replaces rxjs `from(items).pipe(mergeMap(fn, limit), toArray())` in the GitHub provider.
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	fn: (item: T) => Promise<R>,
	limit: number
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const idx = next++;
			if (idx >= items.length) return;
			results[idx] = await fn(items[idx]);
		}
	});

	await Promise.all(workers);
	return results;
}

/**
 * Holds a value and lets callers await the next one matching a predicate.
 *
 * Replaces the rxjs `BehaviorSubject` + `timeout/first/catchError` pipeline the Wago
 * provider used to wait for an API token pushed in from the ad frame.
 */
export class ValueNotifier<T> {
	#value: T;
	#waiters = new Set<(v: T) => void>();

	constructor(initial: T) {
		this.#value = initial;
	}

	get value(): T {
		return this.#value;
	}

	set(value: T): void {
		this.#value = value;
		for (const notify of [...this.#waiters]) notify(value);
	}

	/** Resolves with the first matching value, or `fallback` if `timeoutMs` elapses. */
	waitFor(predicate: (v: T) => boolean, timeoutMs: number, fallback: T): Promise<T> {
		if (predicate(this.#value)) return Promise.resolve(this.#value);

		return new Promise<T>((resolve) => {
			const done = (v: T) => {
				clearTimeout(timer);
				this.#waiters.delete(notify);
				resolve(v);
			};
			const notify = (v: T) => {
				if (predicate(v)) done(v);
			};
			const timer = setTimeout(() => done(fallback), timeoutMs);
			this.#waiters.add(notify);
		});
	}
}

export const strictFilter = <T>(arr: (T | undefined)[]): T[] =>
	arr.filter((item): item is T => item !== undefined);

export const strictFilterBy = <T>(arr: (T | undefined)[], predicate: (val: T) => boolean): T[] =>
	arr.filter((item): item is T => item !== undefined && predicate(item));

export function shortenDownloadCount(value: number, nDigit: number): string {
	if (value < 10) return value.toString();
	const exponent = Math.log10(value);
	const nGroups = Math.floor(exponent / nDigit);
	return (value / Math.pow(10, nGroups * nDigit)).toFixed(0);
}

export function formatSize(size: number): string {
	if (size < 1024) return `${size} bytes`;

	const sizeKb = Math.round(size / 1024);
	if (sizeKb < 1024) return `${sizeKb} kb`;

	return `${Math.round(size / 1024 / 1024)} mb`;
}

/** Round a download count up to the nearest tens place, for display. */
export function roundDownloadCount(value: number): number {
	if (value < 10) return value;

	const numberMatch = /(\d*\.?\d*)e\+(\d+)/.exec(value.toExponential());
	if (numberMatch === null) throw new Error('failed to get number match');

	const number = Math.ceil(parseFloat(numberMatch[1]) * 10);
	const exponent = new Array(parseInt(numberMatch[2] ?? '0') - 1).fill(0);
	return parseInt(`${number}${exponent.join('')}`, 10);
}
