<script lang="ts">
	// Shell for dialogs that have real content rather than just a message — the ones the
	// promise-based `dialogs` store cannot express. Same native <dialog> foundation as
	// DialogHost, so focus trapping, Escape and ::backdrop behave identically.

	import { modalDialog } from '$lib/attachments/modal-dialog';
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		onclose?: () => void;
		/** Suppress Escape / backdrop dismissal (MatDialog disableClose). */
		disableClose?: boolean;
		children: Snippet;
		actions?: Snippet;
	}

	let { title, onclose, disableClose = false, children, actions }: Props = $props();
</script>

<dialog class="wu-dialog" {@attach modalDialog(disableClose)} onclose={() => onclose?.()}>
	<h1 class="dialog-title">{title}</h1>
	<div class="dialog-content">{@render children()}</div>
	{#if actions}
		<div class="dialog-buttons">{@render actions()}</div>
	{/if}
</dialog>

<style>
	/* .wu-dialog, .dialog-title/-content/-buttons are global (styles/theme.css) so that the
	   components rendering their own <dialog> get them too. Only the size override is local. */
	.wu-dialog {
		min-width: 420px;
		max-width: min(720px, 92vw);
	}
</style>
