/** How long work runs before the page says it is busy. */
export const BUSY_INDICATOR_DELAY_MS = 300;

/**
 * Follows `get()`, but turns true only once it has stayed true for `ms`; false as soon as it is.
 *
 * For busy indicators. A load that finishes quickly should just show its result: switching
 * clients flashed My Addons' blur overlay, and Get Addons' spinner, on and straight back off.
 *
 * Call while a component initialises — it owns an effect.
 */
export function delayed(get: () => boolean, ms: number): { readonly current: boolean } {
	let current = $state(false);

	$effect(() => {
		if (!get()) {
			current = false;
			return;
		}
		const timer = setTimeout(() => (current = true), ms);
		return () => clearTimeout(timer);
	});

	return {
		get current() {
			return current;
		}
	};
}
