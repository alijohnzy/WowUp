// Drop-in replacements for the lodash functions the addon providers actually use.
//
// Every call site passes a function iteratee (no string shorthands, no property paths),
// which is what makes a faithful reimplementation short. lodash was 144.5 KB raw in the
// measured Angular bundle; this is the whole of what the providers needed from it.
//
// Null-tolerance is preserved: lodash returns [] / undefined for null collections rather
// than throwing, and several call sites rely on that.

type Iteratee<T, R> = (value: T) => R;

const arr = <T>(c: T[] | null | undefined): T[] => (Array.isArray(c) ? c : []);

export const find = <T>(c: T[] | null | undefined, fn: Iteratee<T, boolean>): T | undefined =>
	arr(c).find(fn);

export const filter = <T>(c: T[] | null | undefined, fn: Iteratee<T, boolean>): T[] =>
	arr(c).filter(fn);

export const map = <T, R>(c: T[] | null | undefined, fn: (value: T) => R): R[] => arr(c).map(fn);

export const take = <T>(c: T[] | null | undefined, n: number): T[] => arr(c).slice(0, n);

export const flatten = <T>(c: (T | T[])[] | null | undefined): T[] => arr(c).flat() as T[];

export const concat = <T>(...values: (T | T[])[]): T[] => ([] as T[]).concat(...values);

/** Stable ascending sort by the iteratee's value. Does not mutate the input. */
export function sortBy<T>(c: T[] | null | undefined, fn: Iteratee<T, number | string | Date>): T[] {
	return [...arr(c)].sort((a, b) => {
		const av = fn(a);
		const bv = fn(b);
		if (av < bv) return -1;
		if (av > bv) return 1;
		return 0;
	});
}

/** Single-iteratee ascending order, matching how the providers call lodash's orderBy. */
export const orderBy = sortBy;

/**
 * Group by a string key.
 * Object.groupBy exists in Electron 43's Chromium 150 but not in the Node the unit tests
 * run on, so this stays a plain implementation.
 */
export function groupBy<T>(
	c: T[] | null | undefined,
	fn: Iteratee<T, string>
): Record<string, T[]> {
	const out: Record<string, T[]> = {};
	for (const item of arr(c)) {
		const key = fn(item);
		(out[key] ??= []).push(item);
	}
	return out;
}

/**
 * Values in `a` that are not in `b`.
 * Set.prototype.difference exists in Electron 43's Chromium 150, but not in the Node the
 * unit tests run on, so this stays a plain implementation.
 */
export const difference = <T>(a: T[] | null | undefined, b: T[] | null | undefined): T[] => {
	const exclude = new Set(arr(b));
	return arr(a).filter((v) => !exclude.has(v));
};

/** Values present in both collections, in `a`'s order, deduplicated like lodash. */
export const intersection = <T>(a: T[] | null | undefined, b: T[] | null | undefined): T[] => {
	const other = new Set(arr(b));
	const seen = new Set<T>();
	return arr(a).filter((v) => {
		if (!other.has(v) || seen.has(v)) return false;
		seen.add(v);
		return true;
	});
};

/** Mutating removal, matching lodash's `_.remove` — returns the removed elements. */
export function remove<T>(c: T[], fn: Iteratee<T, boolean>): T[] {
	const removed: T[] = [];
	for (let i = c.length - 1; i >= 0; i--) {
		if (fn(c[i])) removed.unshift(...c.splice(i, 1));
	}
	return removed;
}

export function maxBy<T>(c: T[] | null | undefined, fn: Iteratee<T, number>): T | undefined {
	let best: T | undefined;
	let bestVal = -Infinity;
	for (const item of arr(c)) {
		const val = fn(item);
		if (val > bestVal) {
			bestVal = val;
			best = item;
		}
	}
	return best;
}
