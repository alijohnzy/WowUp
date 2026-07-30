<script lang="ts">
	// Port of components/addons/my-addons-addon-cell (392 LOC).
	//
	// The Angular version had a BehaviorSubject<AddonViewModel> and *23* observables piped
	// off it, one per template binding, each `listItem$.pipe(map(...))`. That is precisely
	// what $derived does, so the whole block collapses to the expressions below.
	//
	// This is the most-rendered component in the app — one instance per addon row — so the
	// 23 subscriptions per row were also the biggest change-detection cost on the screen.

	import type { ICellRendererParams } from 'ag-grid-community';
	import {
		AddonChannelType,
		AddonDependencyType,
		AddonWarningType,
		type AddonFundingLink
	} from 'wowup-lib-core';
	import { ADDON_PROVIDER_UNKNOWN } from '$common/constants';
	import type { AddonViewModel } from '$lib/business-objects/addon-view-model';
	import { t, i18n } from '$lib/i18n.svelte';
	import * as addonUtils from '$lib/utils/addon';
	import Icon from '$lib/components/common/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import AddonThumbnail from '$lib/components/addons/AddonThumbnail.svelte';
	import FundingButton from '$lib/components/addons/FundingButton.svelte';
	import { session } from '$lib/state/session.svelte';

	interface Props {
		params: ICellRendererParams;
		/** Opens the addon detail dialog. Supplied by the grid page. */
		onViewDetails?: (item: AddonViewModel) => void;
	}

	let { params, onViewDetails }: Props = $props();

	let item = $derived(params.data as AddonViewModel);

	let hasWarning = $derived(item?.addon?.warningType !== undefined);
	let hasIgnoreReason = $derived(!!item?.addon?.ignoreReason);
	let requiredDependencyCount = $derived(
		item?.getDependencies(AddonDependencyType.Required).length ?? 0
	);

	let fundingLinks = $derived<AddonFundingLink[]>(item?.addon?.fundingLinks ?? []);
	let showChannel = $derived(item?.isBetaChannel() || item?.isAlphaChannel());
	let channelClass = $derived(
		item?.isBetaChannel() ? 'beta' : item?.isAlphaChannel() ? 'alpha' : ''
	);

	let channelTranslationKey = $derived(
		(item?.addon?.channelType ?? AddonChannelType.Stable) === AddonChannelType.Alpha
			? 'COMMON.ENUM.ADDON_CHANNEL_TYPE.ALPHA'
			: 'COMMON.ENUM.ADDON_CHANNEL_TYPE.BETA'
	);

	let hasMultipleProviders = $derived(
		item?.addon === undefined ? false : addonUtils.hasMultipleProviders(item.addon)
	);

	// Only flagged when nothing more specific already explains the row's state.
	let isUnknownAddon = $derived(
		!item?.isLoadOnDemand &&
			!hasIgnoreReason &&
			!hasWarning &&
			item?.addon?.providerName === ADDON_PROVIDER_UNKNOWN
	);

	let showUpdateVersion = $derived(session.myAddonsCompactVersion && item?.needsUpdate());

	let ignoreTooltipKey = $derived(
		item?.addon?.ignoreReason === 'git_repo' ? 'PAGES.MY_ADDONS.ADDON_IS_CODE_REPOSITORY' : ''
	);

	let ignoreIcon = $derived<IconName | ''>(
		item?.addon?.ignoreReason === 'git_repo' ? 'fas:code-branch' : ''
	);

	let warningText = $derived.by(() => {
		if (!hasWarning) return '';
		const args = { providerName: item.providerName };

		switch (item.addon?.warningType) {
			case AddonWarningType.MissingOnProvider:
				return i18n.t('COMMON.ADDON_WARNING.MISSING_ON_PROVIDER_TOOLTIP', args);
			case AddonWarningType.NoProviderFiles:
				return i18n.t('COMMON.ADDON_WARNING.NO_PROVIDER_FILES_TOOLTIP', args);
			case AddonWarningType.TocNameMismatch:
				return i18n.t('COMMON.ADDON_WARNING.TOC_NAME_MISMATCH_TOOLTIP', args);
			case AddonWarningType.GameVersionTocMissing:
				return i18n.t('COMMON.ADDON_WARNING.GAME_VERSION_TOC_MISSING_TOOLTIP', args);
			default:
				return i18n.t('COMMON.ADDON_WARNING.GENERIC_TOOLTIP', args);
		}
	});
</script>

<div class="addon-column">
	<div class="thumbnail-container">
		<AddonThumbnail url={item?.addon?.thumbnailUrl ?? ''} name={item?.name ?? ''} />
	</div>

	<div class="version-container">
		<div class="title-container">
			<button
				class="addon-title"
				class:ignored={item?.isIgnored}
				class:text-warning={hasWarning}
				onclick={() => onViewDetails?.(item)}
			>
				{item?.name ?? ''}
			</button>
		</div>

		<div class="addon-version text-2" class:ignored={item?.isIgnored}>
			{#if fundingLinks.length > 0}
				<div class="addon-funding">
					{#each fundingLinks as link (link.url)}
						<FundingButton funding={link} size="small" />
					{/each}
				</div>
			{/if}

			{#if showChannel}
				<div class="channel bg-secondary-3 {channelClass}">{t(channelTranslationKey)}</div>
			{/if}

			{#if hasMultipleProviders}
				<Icon name="fas:code-branch" label={t('PAGES.MY_ADDONS.MULTIPLE_PROVIDERS_TOOLTIP')} />
			{/if}

			{#if item?.addon?.autoUpdateEnabled}
				<Icon name="far:clock" label={t('PAGES.MY_ADDONS.TABLE.AUTO_UPDATE_ICON_TOOLTIP')} />
			{/if}

			{#if requiredDependencyCount > 0}
				<span
					title={i18n.t('COMMON.DEPENDENCY.TOOLTIP', { dependencyCount: requiredDependencyCount })}
				>
					<Icon name="fas:link" />
				</span>
			{/if}

			{#if item?.isLoadOnDemand}
				<span class="text-warning" title={t('PAGES.MY_ADDONS.REQUIRED_DEPENDENCY_MISSING_TOOLTIP')}>
					<Icon name="fas:triangle-exclamation" />
				</span>
			{/if}

			{#if hasWarning}
				<span class="text-warning" title={warningText}>
					<Icon name="fas:triangle-exclamation" />
				</span>
			{/if}

			{#if hasIgnoreReason && ignoreIcon}
				<span class="ignore-icon" title={t(ignoreTooltipKey)}>
					<Icon name={ignoreIcon} />
				</span>
			{/if}

			{#if isUnknownAddon}
				<span class="ignore-icon" title={t('PAGES.MY_ADDONS.UNKNOWN_ADDON_INFO_TOOLTIP')}>
					<Icon name="fas:triangle-exclamation" />
				</span>
			{/if}

			<span class="installed-version">{item?.addon?.installedVersion ?? ''}</span>

			{#if showUpdateVersion}
				<span class="update-version text-1">
					<Icon name="fas:play" />
					<span class="bg-secondary-4 text-2">{item?.addon?.latestVersion ?? ''}</span>
				</span>
			{/if}
		</div>
	</div>
</div>

<style>
	/* ag-grid sets line-height on .ag-cell to roughly the row height, so every line box in here
	   inherits ~60px and the title and version drift apart. The Angular cell pinned explicit
	   font-size/line-height pairs for exactly that reason; these match it. */
	.addon-column {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
		padding-top: 0.5em;
		padding-bottom: 0.5em;
	}

	.thumbnail-container {
		flex: none;
		margin-right: 11px;
	}

	.version-container {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-height: 40px;
		min-width: 0;
		flex: 1;
	}

	.addon-title {
		display: -webkit-box;
		background: none;
		border: 0;
		padding: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
		font-size: 16px;
		line-height: 16px;
		overflow: hidden;
		text-decoration: none;
		white-space: normal;
		word-break: break-word;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.addon-title:hover {
		text-decoration: underline;
		color: var(--text-2);
	}

	.addon-title.ignored {
		opacity: 0.5;
	}

	.addon-version {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-2);
		font-size: 14px;
		line-height: 14px;
	}

	.addon-version.ignored {
		opacity: 0.5;
	}

	.addon-funding {
		display: flex;
		flex-direction: row;
		line-height: 22px;
		gap: 0.2rem;
	}

	.channel {
		text-align: center;
		padding: 0 4px;
		border-radius: 4px;
	}

	.channel.beta {
		color: var(--rare-color);
	}

	.channel.alpha {
		color: var(--epic-color);
	}

	.ignore-icon {
		color: var(--warn-color);
	}

	.update-version {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.update-version span {
		border-radius: 3px;
		padding: 0 0.25rem;
	}
</style>
