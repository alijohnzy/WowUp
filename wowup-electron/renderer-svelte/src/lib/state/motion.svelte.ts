// Animations: page changes, dialogs, menus, the client dropdown, the categories drawer.
//
// All of them are short and move only opacity and transform, which the compositor animates
// without relayout, so they cost little. Still, they are off when the user turns Animations off
// in Options → Application — the switch for a slow computer — and while the OS asks for reduced
// motion.
//
// Two kinds share the switch. CSS animations (styles/motion.css) take their durations from
// --motion and --motion-fast, which `html.no-motion` sets to zero; the shell toggles that class
// from `enabled`. Svelte transitions take theirs from `ms()`.

import type { TransitionConfig } from 'svelte/transition';
import { preferenceStorage } from '$lib/services/storage';

export const ANIMATIONS_KEY = 'animations_enabled';

class Motion {
	/** The Options setting. On unless turned off. */
	setting = $state(true);

	/** The OS's prefers-reduced-motion. */
	osReduced = $state(false);

	enabled = $derived(this.setting && !this.osReduced);

	#initialized = false;

	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		const query =
			typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
		if (query) {
			this.osReduced = query.matches;
			query.addEventListener('change', (e) => (this.osReduced = e.matches));
		}

		const stored = await preferenceStorage.getAsync<unknown>(ANIMATIONS_KEY).catch(() => undefined);
		this.setting = String(stored) !== 'false';
	}

	async set(on: boolean): Promise<void> {
		this.setting = on;
		await preferenceStorage.setAsync(ANIMATIONS_KEY, on);
	}

	/** A Svelte transition's duration: `ms`, or 0 with animations off. */
	ms = (ms: number): number => (this.enabled ? ms : 0);
}

export const motion = new Motion();

/** How long a dialog takes to close (--motion-fast in styles/motion.css, plus a frame). */
export const DIALOG_CLOSE_MS = 140;

/**
 * `out:` for a native <dialog>, for when it is removed while still open — which is how most of
 * them close: the store or the parent drops it. Starts the CSS closing animation and keeps the
 * element until it ends. The CSS does the work because a Svelte transition's own styles reach
 * only the element, and the dimmed ::backdrop behind it would vanish at once.
 *
 * Use it as `out:dialogOut|global`: a dialog is usually its component's root, removed by a block
 * in the parent, and a local transition plays only for its own block.
 */
export function dialogOut(node: Element): TransitionConfig {
	node.classList.add('closing');
	return { duration: motion.ms(DIALOG_CLOSE_MS) };
}
