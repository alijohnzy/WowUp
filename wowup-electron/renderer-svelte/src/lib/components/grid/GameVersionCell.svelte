<script lang="ts">
	// Port of components/addons/game-version-cell (53 LOC).
	//
	// Prefers the game version matching the selected client's major version, then appends
	// "+ N" for the rest.

	import type { ICellRendererParams } from 'ag-grid-community';
	import { session } from '$lib/state/session.svelte';
	import { formatGameVersions } from '$lib/utils/game-version';

	interface Props {
		params: ICellRendererParams;
	}

	let { params }: Props = $props();

	let versions = $derived((params.value as string[]) ?? []);
	let title = $derived(versions.join(', '));

	let displayValue = $derived(
		formatGameVersions(versions, session.getSelectedWowInstallation()?.clientType)
	);
</script>

<span {title}>{displayValue}</span>
