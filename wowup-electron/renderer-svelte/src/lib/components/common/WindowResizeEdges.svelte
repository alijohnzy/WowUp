<script lang="ts">
	// Resize grips for a decorationless Tauri window.
	//
	// Electron used `titleBarStyle: 'hidden'`, which hides the title bar but keeps the native
	// frame — so the OS still handled resizing. Tauri's equivalent is `decorations: false`,
	// which removes the frame entirely: no border, no resize, no corners. The window was stuck
	// at 1280x720 unless maximised.
	//
	// Tauri exposes `startResizeDragging(direction)` for exactly this. These eight zones sit
	// above everything and hand off to the window manager on mousedown, which then runs the
	// resize loop natively — so it feels the same as a normal window rather than a JS
	// approximation.
	//
	// Rendered only under Tauri: under Electron the real frame is still there, and covering
	// its edges with these would take resizing away.

	import { isTauri } from '$lib/ipc';

	// 4px of grab area, doubled at the corners. Matching roughly what GTK and Windows use —
	// wider swallows clicks on whatever is at the window edge, narrower is hard to hit.
	const EDGE = 4;
	const CORNER = 12;

	type Direction =
		'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

	const ZONES: { dir: Direction; style: string; cursor: string }[] = [
		{
			dir: 'North',
			style: `top:0;left:${CORNER}px;right:${CORNER}px;height:${EDGE}px`,
			cursor: 'ns-resize'
		},
		{
			dir: 'South',
			style: `bottom:0;left:${CORNER}px;right:${CORNER}px;height:${EDGE}px`,
			cursor: 'ns-resize'
		},
		{
			dir: 'West',
			style: `left:0;top:${CORNER}px;bottom:${CORNER}px;width:${EDGE}px`,
			cursor: 'ew-resize'
		},
		{
			dir: 'East',
			style: `right:0;top:${CORNER}px;bottom:${CORNER}px;width:${EDGE}px`,
			cursor: 'ew-resize'
		},
		{
			dir: 'NorthWest',
			style: `top:0;left:0;width:${CORNER}px;height:${CORNER}px`,
			cursor: 'nwse-resize'
		},
		{
			dir: 'NorthEast',
			style: `top:0;right:0;width:${CORNER}px;height:${CORNER}px`,
			cursor: 'nesw-resize'
		},
		{
			dir: 'SouthWest',
			style: `bottom:0;left:0;width:${CORNER}px;height:${CORNER}px`,
			cursor: 'nesw-resize'
		},
		{
			dir: 'SouthEast',
			style: `bottom:0;right:0;width:${CORNER}px;height:${CORNER}px`,
			cursor: 'nwse-resize'
		}
	];

	async function startResize(e: MouseEvent, dir: Direction) {
		// Left button only: a right-click here should fall through to whatever context menu
		// the window manager offers.
		if (e.button !== 0) return;
		e.preventDefault();

		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		try {
			await getCurrentWindow().startResizeDragging(dir);
		} catch (err) {
			console.error(`resize ${dir} failed`, err);
		}
	}
</script>

{#if isTauri()}
	{#each ZONES as zone (zone.dir)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="resize-zone"
			style="{zone.style};cursor:{zone.cursor}"
			onmousedown={(e) => startResize(e, zone.dir)}
		></div>
	{/each}
{/if}

<style>
	.resize-zone {
		position: fixed;
		z-index: 9999;
		/* Invisible: the cursor change is the only affordance, as with a native frame. */
		background: transparent;
	}
</style>
