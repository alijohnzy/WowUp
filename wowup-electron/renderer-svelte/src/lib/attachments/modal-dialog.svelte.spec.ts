// Every modal <dialog> is counted while open, so the Tauri ad view (a native webview drawn
// above the page) can hide for page-local dialogs too, not only those in the `dialogs` stack.

import { describe, expect, it } from 'vitest';
import { modalDialog } from './modal-dialog';
import { openModals } from '$lib/state/open-modals.svelte';

describe('modalDialog', () => {
	it('counts a dialog from opening until it closes', () => {
		const node = document.createElement('dialog');
		const detach = modalDialog()(node);

		expect(node.open).toBe(true);
		expect(openModals.count).toBe(1);

		node.close();
		expect(openModals.count).toBe(0);

		// Removed from the page after closing: counted down once, not twice.
		detach();
		expect(openModals.count).toBe(0);
	});

	it('counts down when a dialog leaves the page without closing', () => {
		const a = modalDialog()(document.createElement('dialog'));
		const b = modalDialog(true)(document.createElement('dialog'));
		expect(openModals.count).toBe(2);

		a();
		b();
		expect(openModals.count).toBe(0);
	});
});
