<script lang="ts">
	// Replaces @angular/material/menu for the right-click menus.
	//
	// My Addons alone had four MatMenu trees, each needing a hidden trigger element whose
	// left/top were bound to a `contextMenuPosition` object, plus <ng-template matMenuContent>
	// to pass the clicked row in. Here the menu is a positioned element and the content is a
	// snippet, so the trigger element and the data channel both disappear.

	import type { Snippet } from 'svelte';

	interface Props {
		x: number;
		y: number;
		onclose: () => void;
		children: Snippet;
	}

	let { x, y, onclose, children }: Props = $props();

	let menu = $state<HTMLDivElement | undefined>(undefined);

	// Keep the menu on screen when opened near an edge.
	let position = $derived.by(() => {
		const width = menu?.offsetWidth ?? 220;
		const height = menu?.offsetHeight ?? 240;
		const maxX = window.innerWidth - width - 8;
		const maxY = window.innerHeight - height - 8;
		return { left: Math.max(8, Math.min(x, maxX)), top: Math.max(8, Math.min(y, maxY)) };
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="menu-backdrop"
	onclick={onclose}
	oncontextmenu={(e) => {
		e.preventDefault();
		onclose();
	}}
></div>

<div
	bind:this={menu}
	class="context-menu text-1"
	role="menu"
	tabindex="-1"
	style:left="{position.left}px"
	style:top="{position.top}px"
>
	{@render children()}
</div>

<style>
	/* Opaque, not `bg-secondary-4`. --background-secondary-4 is rgba(…, 0.8), which is correct
	   for panels that sit *in* the layout and wrong for anything floating over it — the addon
	   grid showed straight through this menu. --background-secondary-2-fill is the theme's
	   opaque surface token, the same one .wu-dialog and native popups use.
	   Angular did not need this rule at all: mat-menu's panel surface came from
	   mat.all-component-themes, which the port dropped along with the rest of Material. */
	.context-menu {
		background: var(--background-secondary-2-fill);
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.context-menu {
		position: fixed;
		z-index: 41;
		min-width: 220px;
		max-height: 80vh;
		overflow-y: auto;
		padding: 0.35rem;
		border-radius: 4px;
		box-shadow: 0 8px 28px rgb(0 0 0 / 45%);
	}

	:global(.context-menu .menu-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 0;
		border-radius: 3px;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	:global(.context-menu .menu-item:hover) {
		background: var(--overlay-hover);
	}

	:global(.context-menu .menu-divider) {
		border-top: 1px solid var(--overlay-selected);
		margin: 0.3rem 0;
	}

	:global(.context-menu .menu-header) {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.6rem;
	}
</style>
