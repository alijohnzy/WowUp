<script lang="ts">
	// Minimal cell used only by svelte-cell-renderer.svelte.spec.ts to verify the bridge
	// mounts, refreshes in place, unmounts, and forwards cellRendererParams as props.
	import type { ICellRendererParams } from 'ag-grid-community';

	interface Props {
		params: ICellRendererParams;
		/** Comes from the column's cellRendererParams, not from ag-grid. */
		label?: string;
		onPoke?: (value: unknown) => void;
	}

	let { params, label, onPoke }: Props = $props();
</script>

<!-- The extras render only when supplied, so the bridge's other tests can keep asserting on
     textContent without this probe's additions leaking into them. -->
<span>{params.value}</span>
{#if label}<span class="label">{label}</span>{/if}
{#if onPoke}<button onclick={() => onPoke?.(params.value)}>poke</button>{/if}
