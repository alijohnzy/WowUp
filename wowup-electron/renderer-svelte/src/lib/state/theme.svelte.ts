// The active theme class, split out of session.svelte.ts.
//
// It was three lines in `Session` — a `$state`, a read in `init()`, and a preference listener —
// but nothing about it is session state: the shell puts the value on <div class="app-root">
// and Options → Application writes it. Keeping it here means a component that only needs the
// theme does not reach into the object that also owns installations, tab context and account
// passthrough.

import { CURRENT_THEME_KEY } from '$common/constants';
import { wowup } from '$lib/state/wowup.svelte';

export const DEFAULT_THEME_CLASS = 'default-theme';

class Theme {
	current = $state(DEFAULT_THEME_CLASS);

	#initialized = false;

	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		this.current = await wowup.getCurrentTheme().catch(() => DEFAULT_THEME_CLASS);

		// The preference is written by the main process too (the app menu can change it), so the
		// change feed is the source of truth rather than only the local setter.
		wowup.onPreferenceChange((change) => {
			if (change.key === CURRENT_THEME_KEY) this.current = change.value;
		});
	}

	async set(themeClass: string): Promise<void> {
		this.current = themeClass;
		await wowup.setCurrentTheme(themeClass);
	}
}

export const theme = new Theme();
