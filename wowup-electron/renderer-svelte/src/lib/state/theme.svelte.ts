// The active theme class, split out of session.svelte.ts.
//
// It was three lines in `Session` — a `$state`, a read in `init()`, and a preference listener —
// but nothing about it is session state: the shell puts the value on <div class="app-root">
// and Options → Application writes it. Keeping it here means a component that only needs the
// theme does not reach into the object that also owns installations, tab context and account
// passthrough.

import { CURRENT_THEME_KEY } from '$common/constants';
import { preferenceStorage } from '$lib/services/storage';
import { wowup } from '$lib/state/wowup.svelte';

export const DEFAULT_THEME_CLASS = 'default-theme';

/** Options → Application: My Addons and Get Addons draw buttons in the client's color. */
export const CLIENT_COLOR_BUTTONS_KEY = 'client_color_buttons';

class Theme {
	current = $state(DEFAULT_THEME_CLASS);

	/** See CLIENT_COLOR_BUTTONS_KEY and utils/client-color.ts. Off: the theme's own colors. */
	clientColorButtons = $state(false);

	#initialized = false;

	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		this.current = await wowup.getCurrentTheme().catch(() => DEFAULT_THEME_CLASS);
		this.clientColorButtons = await preferenceStorage
			.getBool(CLIENT_COLOR_BUTTONS_KEY)
			.catch(() => false);

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

	async setClientColorButtons(on: boolean): Promise<void> {
		this.clientColorButtons = on;
		await preferenceStorage.setAsync(CLIENT_COLOR_BUTTONS_KEY, on);
	}
}

export const theme = new Theme();
