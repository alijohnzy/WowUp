// Every modal <dialog> is counted while open, so the Tauri ad view (a native webview drawn
// above the page) can hide for page-local dialogs too, not only those in the `dialogs` stack.
//
// Closing animates: close() and Escape hold the dialog open, marked `closing`, while the CSS
// animation plays — and close at once with animations off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modalDialog } from './modal-dialog';
import { DIALOG_CLOSE_MS, motion } from '$lib/state/motion.svelte';
import { openModals } from '$lib/state/open-modals.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	motion.setting = true;
});

describe('modalDialog', () => {
	it('counts a dialog from opening until it closes', () => {
		const node = document.createElement('dialog');
		const detach = modalDialog()(node);

		expect(node.open).toBe(true);
		expect(openModals.count).toBe(1);

		node.close();
		vi.advanceTimersByTime(DIALOG_CLOSE_MS);
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

	it('plays the closing animation before it closes', () => {
		const node = document.createElement('dialog');
		const detach = modalDialog()(node);

		node.close();
		expect(node.open).toBe(true);
		expect(node.classList.contains('closing')).toBe(true);

		vi.advanceTimersByTime(DIALOG_CLOSE_MS);
		expect(node.open).toBe(false);
		detach();
	});

	it('animates Escape too, unless the dialog refused to close', () => {
		const node = document.createElement('dialog');
		const detach = modalDialog()(node);

		node.dispatchEvent(new Event('cancel', { cancelable: true }));
		expect(node.classList.contains('closing')).toBe(true);
		vi.advanceTimersByTime(DIALOG_CLOSE_MS);
		expect(node.open).toBe(false);
		detach();

		const busy = document.createElement('dialog');
		busy.addEventListener('cancel', (e) => e.preventDefault());
		const detachBusy = modalDialog()(busy);
		busy.dispatchEvent(new Event('cancel', { cancelable: true }));
		vi.advanceTimersByTime(DIALOG_CLOSE_MS);
		expect(busy.open).toBe(true);
		detachBusy();
	});

	it('closes at once with animations off', () => {
		motion.setting = false;
		const node = document.createElement('dialog');
		const detach = modalDialog()(node);

		node.close();
		expect(node.open).toBe(false);
		expect(node.classList.contains('closing')).toBe(false);
		detach();
	});
});
