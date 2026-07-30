// Replaces src/app/directives/external-link.directive.ts.
//
// NOTE — behaviour change, deliberate. The Angular directive is dead code: its @HostListener
// body is entirely commented out, so `<a appExternalLink href="https://…">` currently lets the
// renderer navigate away from the app (the main process only intercepts will-navigate for the
// wago webview, not the app window). This attachment does what the directive was evidently
// meant to do — hand the URL to the OS browser and stay put.
//
// Per the migration playbook: fix it in the new code, do not touch original/, and record it.

import { openExternal } from '$lib/ipc';

/**
 * Usage: <a href="https://wowup.io" {@attach externalLink()}>…</a>
 *
 * Attachments re-run when their arguments change and return their own cleanup, so this
 * needs no lifecycle wiring.
 */
export function externalLink() {
	return (node: HTMLAnchorElement) => {
		const onClick = (event: MouseEvent) => {
			const href = node.getAttribute('href');
			if (!href || href.startsWith('#')) return;

			event.preventDefault();
			openExternal(href).catch((e: unknown) => console.error('openExternal failed', href, e));
		};

		node.addEventListener('click', onClick);
		return () => node.removeEventListener('click', onClick);
	};
}
