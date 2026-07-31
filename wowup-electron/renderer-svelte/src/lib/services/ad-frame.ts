// The Tauri half of the ad frame. See src-tauri/src/ad.rs for why it is a child webview
// rather than an element, and why the Wago token comes back over a blocked navigation.
//
// The consequence worth knowing: a child webview is an overlay on the window, not a node in
// the document. It does not scroll, clip or stack with the page, so it has to be told where
// to sit and kept there. `track()` below is that.

import { invoke } from '$lib/ipc';

const IPC_AD_FRAME_OPEN = 'ad-frame-open';
const IPC_AD_FRAME_CLOSE = 'ad-frame-close';
const IPC_AD_FRAME_RELOAD = 'ad-frame-reload';
const IPC_AD_FRAME_SET_BOUNDS = 'ad-frame-set-bounds';

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The element's position in CSS pixels relative to the window, which is the logical-pixel
 * space the Rust side positions the webview in — so this is correct under display scaling
 * without converting anything.
 */
function boundsOf(element: HTMLElement): Bounds {
	const rect = element.getBoundingClientRect();
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const same = (a: Bounds | undefined, b: Bounds): boolean =>
	!!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const adFrame = {
	async open(element: HTMLElement, url: string, userAgent?: string): Promise<void> {
		const { x, y, width, height } = boundsOf(element);
		await invoke(IPC_AD_FRAME_OPEN, url, userAgent, x, y, width, height);
	},

	async close(): Promise<void> {
		await invoke(IPC_AD_FRAME_CLOSE);
	},

	async reload(): Promise<void> {
		await invoke(IPC_AD_FRAME_RELOAD);
	},

	/**
	 * Keep the overlay over `element` until the returned teardown runs.
	 *
	 * Watches the element itself (the rail collapses and expands) and the window (a resize
	 * moves the slot without changing its size, so a ResizeObserver alone would miss it).
	 * Bounds are compared before sending because both fire far more often than they change
	 * anything, and each call crosses IPC and hits the window on the main thread.
	 */
	track(element: HTMLElement): () => void {
		let last: Bounds | undefined;

		const push = () => {
			const bounds = boundsOf(element);
			if (same(last, bounds)) return;
			last = bounds;
			void invoke(
				IPC_AD_FRAME_SET_BOUNDS,
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height
			).catch((e: unknown) => console.error('ad frame set bounds failed', e));
		};

		const observer = new ResizeObserver(push);
		observer.observe(element);
		window.addEventListener('resize', push);

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', push);
		};
	}
};
