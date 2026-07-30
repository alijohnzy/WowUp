<script lang="ts">
	// Port of components/addons/game-version-cell (53 LOC).
	//
	// Prefers the game version matching the selected client's major version, then appends
	// "+ N" for the rest.

	import type { ICellRendererParams } from 'ag-grid-community';
	import { getWowMajorVersion } from 'wowup-lib-core';
	import { session } from '$lib/state/session.svelte';

	interface Props {
		params: ICellRendererParams;
	}

	let { params }: Props = $props();

	let versions = $derived((params.value as string[]) ?? []);
	let title = $derived(versions.join(', '));

	let displayValue = $derived.by(() => {
		const wowInstall = session.getSelectedWowInstallation();
		let display = versions[0] ?? '';

		if (wowInstall !== undefined) {
			const majorVersion = getWowMajorVersion(wowInstall.clientType);
			const match = versions.find((v) => v.startsWith(`${majorVersion}.`));
			if (match !== undefined) display = match;
		}

		if (versions.length - 1 > 0) display += `, ${versions.length - 1} +`;
		return display;
	});
</script>

<span {title}>{displayValue}</span>
