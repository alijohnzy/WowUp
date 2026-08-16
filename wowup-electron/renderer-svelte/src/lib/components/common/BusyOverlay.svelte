<script lang="ts">
	// The progress indicator shown while a page is working *on content it is already showing*.
	//
	// My Addons used to swap its entire content for a spinner, so an update run hid the very
	// table it was updating — the page went blank for the length of the run and came back with
	// the answer. This keeps the table on screen and puts the spinner above it: the rows can be
	// watched changing state through the blur, which is the part worth seeing.
	//
	// A native modal <dialog> rather than a positioned div, because `showModal()` makes the
	// rest of the document inert for free. No pointer-events juggling, no tab focus escaping
	// into a control that must not be touched until the run finishes, and it renders in the
	// top layer so it cannot be covered by anything the page draws.
	//
	// `modalDialog(true)` sets `closedby: none`, so neither Escape nor a backdrop click
	// dismisses it. That is deliberate: there is nothing to cancel — the run owns the dialog
	// and takes it away when it is done.
	//
	// It draws no surface of its own — no panel, no border — so the only thing over the table
	// is the message itself. ProgressSpinner already centres its own content in the space it
	// is given, which is now the whole viewport.

	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import { modalDialog } from '$lib/attachments/modal-dialog';

	interface Props {
		message?: string;
	}

	let { message = '' }: Props = $props();
</script>

<dialog class="busy-overlay" {@attach modalDialog(true)}>
	<ProgressSpinner {message} />
</dialog>

<style>
	.busy-overlay {
		/* No card: the dialog fills the viewport and paints nothing, so all that shows is the
		   message over the blurred table. The UA stylesheet gives a <dialog> a border, padding,
		   a background and `width: fit-content`, and the max-* defaults would cap it well short
		   of the viewport — every one of them has to be undone explicitly. */
		position: fixed;
		inset: 0;
		margin: 0;
		border: 0;
		padding: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		background: transparent;
		color: var(--text-1);
		/* Not a box, just enough separation to keep the message legible against whatever row
		   happens to be behind it. Drop it if it reads as decoration. */
		text-shadow: 0 1px 4px rgb(0 0 0 / 55%);
	}

	.busy-overlay::backdrop {
		/* Light on both counts on purpose. The point of the overlay is that the table stays
		   readable enough to watch, so this separates it from the dialog without hiding it —
		   a heavier blur or tint would be the blank page again in a different costume. */
		background: rgb(0 0 0 / 30%);
		-webkit-backdrop-filter: blur(2px);
		backdrop-filter: blur(2px);
	}
</style>
