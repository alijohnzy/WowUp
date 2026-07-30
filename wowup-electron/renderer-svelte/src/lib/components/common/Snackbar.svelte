<script lang="ts">
	// Port of components/common/centered-snackbar/centered-snackbar.component.ts (22 LOC)
	// plus the rendering half of MatSnackBar. State lives in $lib/state/snackbar.svelte, which
	// holds one message at a time — see the note there.

	import { snackbar } from '$lib/state/snackbar.svelte';
	import { fly } from 'svelte/transition';
</script>

<div class="snackbar-host" role="status" aria-live="polite">
	{#if snackbar.current}
		{#key snackbar.current.id}
			<!-- svelte transitions replace @angular/animations here -->
			<div
				class="snackbar {snackbar.current.classes.join(' ')}"
				transition:fly={{ y: 24, duration: 150 }}
			>
				{snackbar.current.message}
			</div>
		{/key}
	{/if}
</div>

<style>
	.snackbar-host {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 1000;
		pointer-events: none;
	}

	.snackbar {
		padding: 0.75rem 1.25rem;
		border-radius: 4px;
		text-align: center;
		background: var(--background-secondary-4);
		box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
	}

	.snackbar:global(.snackbar-success) {
		border-left: 3px solid #4caf50;
	}

	.snackbar:global(.snackbar-error) {
		border-left: 3px solid #f44336;
	}
</style>
