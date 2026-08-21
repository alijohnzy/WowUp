// Stops a link inside injected HTML from navigating the app away from itself.
//
// Addon descriptions, changelogs, news items and release notes are all rendered with
// `{@html}`, and their anchors are not ours to put a handler on. A click on one navigated the
// top-level document: the window became icy-veins.com, and since the app draws its own
// titlebar there is no back button, no address bar and no way home short of killing it.
//
// The Angular app has the same hole. `external-link.directive.ts` is dead code -- its
// @HostListener body is commented out -- and the main process only intercepts `will-navigate`
// for the wago webview, not the app window.
//
// Deliberately not done in Rust. `on_navigation` would be the airtight place for it, but
// wry fires it for subframes too and Tauri's callback receives only a URL, so it cannot tell
// the app navigating from the ad frame loading its own creative. Blocking on it took the ad
// frame down once already.

import { confirmLinkNavigation } from '$lib/services/links';

/** Everything else -- `javascript:`, `file:`, `data:` -- is dropped rather than handed on. */
const OPENABLE = new Set(['http:', 'https:', 'mailto:']);

/**
 * Usage: `$effect(() => guardExternalLinks());`
 *
 * Listens on the bubble phase, so an anchor with its own handler (the `externalLink`
 * attachment) gets there first; `defaultPrevented` is how this stands aside rather than
 * opening the same URL twice.
 */
export function guardExternalLinks(): () => void {
	const onClick = (event: MouseEvent) => {
		if (event.defaultPrevented) return;

		const anchor = (event.target as Element | null)?.closest?.('a[href]');
		const href = anchor?.getAttribute('href');
		if (!href) return;

		let url: URL;
		try {
			url = new URL(href, window.location.href);
		} catch {
			return;
		}

		// An in-app route. SvelteKit's own router owns these, and hijacking them would break
		// every nav link in the rail.
		if (url.origin === window.location.origin) return;

		event.preventDefault();
		if (!OPENABLE.has(url.protocol)) {
			console.warn(`[links] refusing to open ${url.protocol} link`);
			return;
		}

		void confirmLinkNavigation(url.href);
	};

	// `auxclick` covers the middle button, which otherwise navigates just the same.
	document.addEventListener('click', onClick);
	document.addEventListener('auxclick', onClick);
	return () => {
		document.removeEventListener('click', onClick);
		document.removeEventListener('auxclick', onClick);
	};
}
