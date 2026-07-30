// jsdom lacks a few APIs the ported components touch on mount.
// Keep this minimal — anything stubbed here is behaviour a test is not covering.

import { afterEach } from 'vitest';

// bits-ui and the dialog host both query matchMedia for reduced-motion.
if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	})) as unknown as typeof window.matchMedia;
}

// jsdom implements <dialog> but not showModal/close.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});
