<script lang="ts">
	// Port of components/addons/potential-addon-table-cell (239 LOC).
	//
	// Removed: OnChanges (the Angular version recomputed `_latestChannelType` and
	// `_requiredDependencies` in ngOnChanges; both are $derived here), and the
	// GetAddonListItemFilePropPipe injected as a service.

	import type { ICellRendererParams } from 'ag-grid-community';
	import { AddonChannelType, AddonDependencyType, type AddonSearchResult } from 'wowup-lib-core';
	import type { GetAddonListItem } from '$lib/business-objects/get-addon-list-item';
	import { t, i18n } from '$lib/i18n.svelte';
	import { addonFileProp } from '$lib/utils/format';
	import { getDependencyType, getLatestFile } from '$lib/utils/search-result';
	import Icon from '$lib/components/common/Icon.svelte';
	import AddonThumbnail from '$lib/components/addons/AddonThumbnail.svelte';
	import ClientDots from '$lib/components/common/ClientDots.svelte';
	import { addonFlavors } from '$lib/state/addon-flavors.svelte';
	import { session } from '$lib/state/session.svelte';

	interface Props {
		params: ICellRendererParams;
		/** Channel currently selected on the Get Addons page. */
		channel?: AddonChannelType;
		onViewDetails?: (evt: {
			searchResult: AddonSearchResult;
			channelType: AddonChannelType;
		}) => void;
	}

	let { params, channel = AddonChannelType.Stable, onViewDetails }: Props = $props();

	let addon = $derived(params.data as GetAddonListItem);

	let latestChannelType = $derived(
		getLatestFile(addon?.searchResult, channel)?.channelType ?? AddonChannelType.Stable
	);

	let isBetaChannel = $derived(latestChannelType === AddonChannelType.Beta);
	let isAlphaChannel = $derived(latestChannelType === AddonChannelType.Alpha);

	let channelTranslationKey = $derived(
		latestChannelType === AddonChannelType.Alpha
			? 'COMMON.ENUM.ADDON_CHANNEL_TYPE.ALPHA'
			: 'COMMON.ENUM.ADDON_CHANNEL_TYPE.BETA'
	);

	let requiredDependencyCount = $derived(
		addon?.searchResult
			? getDependencyType(addon.searchResult, channel, AddonDependencyType.Required).length
			: 0
	);

	let version = $derived(String(addonFileProp(addon?.searchResult, 'version', channel) ?? ''));

	// The user's other flavors that already have this addon. The one on screen is left out: the
	// status column already says whether it is installed there.
	let installedInClients = $derived(
		addon?.searchResult
			? addonFlavors.installedIn(addon.searchResult, session.selectedWowInstallation?.id)
			: []
	);
	let installedIn = $derived(installedInClients.map((i) => i.displayName).join(', '));
</script>

<div class="addon-column">
	<div class="thumbnail-container bg-secondary-3">
		<AddonThumbnail url={addon?.thumbnailUrl ?? ''} name={addon?.name ?? ''} />
	</div>

	<div class="addon-text">
		<button
			class="addon-title"
			onclick={() =>
				onViewDetails?.({ searchResult: addon.searchResult, channelType: latestChannelType })}
		>
			{addon?.name ?? ''}
		</button>

		<div class="addon-version text-2">
			{#if isBetaChannel || isAlphaChannel}
				<div class="channel" class:beta={isBetaChannel} class:alpha={isAlphaChannel}>
					{t(channelTranslationKey)}
				</div>
			{/if}

			{#if requiredDependencyCount > 0}
				<span
					class="dependency-icon"
					title={i18n.t('COMMON.DEPENDENCY.TOOLTIP', {
						dependencyCount: requiredDependencyCount
					})}
				>
					<Icon name="fas:link" />
				</span>
			{/if}

			<span>{version}</span>
		</div>

		{#if installedIn}
			<div class="installed-in text-3" title={installedIn}>
				<ClientDots installations={installedInClients} />
				<span class="installed-in-text">
					{i18n.t('PAGES.GET_ADDONS.INSTALLED_IN', { clients: installedIn })}
				</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.addon-column {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 100%;
	}

	.thumbnail-container {
		flex: none;
		border-radius: 4px;
	}

	.addon-text {
		min-width: 0;
	}

	.addon-title {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.addon-title:hover {
		text-decoration: underline;
	}

	.addon-version {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
	}

	.installed-in {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		line-height: 1.2;
	}

	.installed-in-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.channel {
		padding: 0 0.35rem;
		border-radius: 3px;
		font-size: 0.7rem;
	}

	.channel.beta {
		color: #64b5f6;
	}

	.channel.alpha {
		color: #ffb74d;
	}
</style>
