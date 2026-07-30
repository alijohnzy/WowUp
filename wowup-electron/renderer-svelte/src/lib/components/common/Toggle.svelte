<script lang="ts">
	// Replaces <mat-slide-toggle> — 17 instances across the Options screens, plus the
	// consent dialog. bits-ui Switch supplies the role/aria/keyboard behaviour; the visual
	// is ~30 lines of CSS instead of Material's theming layer.

	import { Switch } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		checked?: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
		children?: Snippet;
	}

	let { checked = $bindable(false), disabled = false, onCheckedChange, children }: Props = $props();

	const id = $props.id();
</script>

<div class="toggle-row">
	<Switch.Root bind:checked {disabled} {onCheckedChange} class="switch-root" aria-labelledby={id}>
		<Switch.Thumb class="switch-thumb" />
	</Switch.Root>
	{#if children}
		<label for={id} {id} class="toggle-label">{@render children()}</label>
	{/if}
</div>

<style>
	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	:global(.switch-root) {
		flex: none;
		width: 38px;
		height: 20px;
		border-radius: 999px;
		border: 0;
		padding: 2px;
		cursor: pointer;
		/* Was var(--overlay-border) — a white wash that is invisible on the light themes.
		   The off-track and thumb both have to come from theme tokens. */
		background: var(--background-secondary-5);
		transition: background 120ms ease;
	}

	:global(.switch-root[data-state='checked']) {
		background: var(--control-color);
	}

	:global(.switch-root[data-disabled]) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.switch-root:focus-visible) {
		outline: 2px solid var(--control-color);
		outline-offset: 2px;
	}

	:global(.switch-thumb) {
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		/* Grey against the off-track, white against the saturated on-track. */
		background: var(--text-3);
		transition:
			transform 120ms ease,
			background 120ms ease;
	}

	:global(.switch-root[data-state='checked'] .switch-thumb) {
		transform: translateX(18px);
		background: #fff;
	}

	.toggle-label {
		cursor: pointer;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.switch-root),
		:global(.switch-thumb) {
			transition: none;
		}
	}
</style>
