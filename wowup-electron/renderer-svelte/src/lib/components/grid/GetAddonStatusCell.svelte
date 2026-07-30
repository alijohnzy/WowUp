<script lang="ts">
	// Port of components/addons/get-addon-status-cell (56 LOC).

	import type { ICellRendererParams } from 'ag-grid-community';
	import { t } from '$lib/i18n.svelte';
	import AddonInstallButton from '$lib/components/addons/AddonInstallButton.svelte';
	import type { AddonSearchResult } from 'wowup-lib-core';

	interface Props {
		params: ICellRendererParams;
	}

	let { params }: Props = $props();

	let addonSearchResult = $derived(
		(params.data as { searchResult?: AddonSearchResult } | undefined)?.searchResult
	);
</script>

<div class="addon-status-column">
	{#if addonSearchResult?.externallyBlocked === true}
		<div class="unavailable" title={t('COMMON.ADDON_STATE.UNAVAILABLE_TOOLTIP')}>
			{t('COMMON.ADDON_STATE.UNAVAILABLE')}
		</div>
	{:else if addonSearchResult}
		<AddonInstallButton {addonSearchResult} onViewUpdated={() => params.api?.resetRowHeights()} />
	{/if}
</div>

<style>
	.addon-status-column {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.unavailable {
		opacity: 0.7;
	}
</style>
