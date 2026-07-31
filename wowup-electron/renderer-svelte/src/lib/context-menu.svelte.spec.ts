// The native context menu must not open, and the app's own menus must still work.
//
// Electron shows no context menu unless the app builds one, so every right-click here is
// already owned — addon rows, grid headers, the menu backdrop. WebKitGTK does show one, so
// under Tauri a right-click produced the app's menu with a native "Reload / Inspect
// Element" menu over the top, and on anything without a handler only the native one.
//
// The suppression runs in the capture phase, which is what makes it robust: it cannot be
// bypassed by a handler that calls stopPropagation, and it still leaves those handlers to
// open their own menus.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ipc-tauri', () => ({}));

// Named *.svelte.spec.ts so vitest runs it in the jsdom project — the node project has no
// document to right-click on.

import { suppressNativeContextMenu } from './ipc';

let teardown: (() => void) | undefined;
afterEach(() => {
	teardown?.();
	teardown = undefined;
	document.body.innerHTML = '';
});

const rightClick = (target: EventTarget) => {
	const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
	target.dispatchEvent(event);
	return event;
};

describe('native context menu', () => {
	it('is suppressed anywhere in the document', () => {
		teardown = suppressNativeContextMenu();

		// The nav rail and empty grid space have no handler of their own; without this they
		// showed the webview's menu and nothing else.
		expect(rightClick(document.body).defaultPrevented).toBe(true);
	});

	it('still lets a component open its own menu', () => {
		const row = document.createElement('div');
		document.body.appendChild(row);
		const opened = vi.fn();
		row.addEventListener('contextmenu', opened);

		teardown = suppressNativeContextMenu();
		const event = rightClick(row);

		expect(opened).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
	});

	it('suppresses even when a handler stops propagation', () => {
		// ag-grid's cell handler does not preventDefault itself, and a handler that also
		// stopped propagation would leave a bubble-phase listener never running.
		const cell = document.createElement('div');
		document.body.appendChild(cell);
		cell.addEventListener('contextmenu', (e) => e.stopPropagation());

		teardown = suppressNativeContextMenu();

		expect(rightClick(cell).defaultPrevented).toBe(true);
	});

	it('stops suppressing once torn down', () => {
		suppressNativeContextMenu()();

		expect(rightClick(document.body).defaultPrevented).toBe(false);
	});
});
