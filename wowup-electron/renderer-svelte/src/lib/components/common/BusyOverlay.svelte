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
		/* Tailwind's preflight resets margin to 0 on every element, which anchors a modal
		   <dialog> to the top-left instead of centring it — same restore as .wu-dialog. */
		margin: auto;
		border: 0;
		border-radius: 8px;
		padding: 1.5rem 2rem;
		min-width: 16rem;
		max-width: min(30rem, 90vw);
		color: var(--text-1);
		background: var(--background-secondary-2-fill);
		box-shadow: 0 8px 32px rgb(0 0 0 / 45%);
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
