<script lang="ts">
	// Port of src/app/components/addons/addon-detail/addon-detail.component.{ts,html} (580 LOC).
	//
	// The Angular component computed 24 public fields in ngOnInit by hand — title, subtitle,
	// provider, summary, version, hasIconUrl, hasFundingLinks, isUnknownProvider and so on —
	// each a manual assignment from the same `model` object, because a template cannot call
	// methods cheaply under OnPush. Every one of them is a pure function of `model`, so here
	// they are $derived and the ngOnInit block disappears entirely.
	//
	// Also removed: ChangeDetectorRef (3 explicit detectChanges() calls), a _destroy$ Subject
	// with 5 takeUntil() pipes, two BehaviorSubjects for the async-piped changelog and
	// description, ViewChildren/ViewChild queries that nothing read, and ng-gallery — see
	// ImageGallery.svelte.

	import { modalDialog } from '$lib/attachments/modal-dialog';
	import { ADDON_PROVIDER_GITHUB, ADDON_PROVIDER_UNKNOWN } from '$common/constants';
	import { AddonChannelType, AddonDependencyType, type Addon } from 'wowup-lib-core';
	import { t } from '$lib/i18n.svelte';
	import { addonService, onAddonInstalled } from '$lib/state/addon.svelte';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { resource } from 'runed';
	import { page } from '$app/state';
	import { currentPath, ROUTES } from '$lib/routes';
	import { session, type DetailsTabType } from '$lib/state/session.svelte';
	import { wowup } from '$lib/state/wowup.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { handleRemoveAddon } from '$lib/services/addon-ui';
	import { openExternalLink } from '$lib/services/links';
	import * as clipboard from '$lib/services/clipboard';
	import * as SearchResult from '$lib/utils/search-result';
	import type { AddonDetailData } from '$lib/state/dialogs.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import ImageGallery from '$lib/components/common/ImageGallery.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import AddonInstallButton from './AddonInstallButton.svelte';
	import AddonUpdateButton from './AddonUpdateButton.svelte';
	import FundingButton from './FundingButton.svelte';

	interface Props {
		model: AddonDetailData;
		onclose: () => void;
	}

	let { model, onclose }: Props = $props();

	let listItem = $derived(model.listItem);
	let searchResult = $derived(model.searchResult);
	let channelType = $derived(model.channelType ?? AddonChannelType.Stable);

	// AddonViewModel is a class, and $state only deep-proxies plain objects and arrays — so
	// mutating listItem.addon (which the install listener still does, because the grid row
	// holds the same instance) is invisible to this component. This box is what makes the
	// header and buttons re-render mid-install.
	let installedAddon = $state<Addon | undefined>(undefined);

	// ---- derived view model ---------------------------------------------------------------
	// Each of these was a hand-assigned field in ngOnInit.

	let addon = $derived(installedAddon ?? listItem?.addon);

	let title = $derived(addon?.name || searchResult?.name || 'UNKNOWN');
	let subtitle = $derived(addon?.author || searchResult?.author || 'UNKNOWN');
	let provider = $derived(addon?.providerName || searchResult?.providerName || 'UNKNOWN');
	let externalUrl = $derived(addon?.externalUrl || searchResult?.externalUrl || 'UNKNOWN');
	let imageUrl = $derived(addon?.thumbnailUrl || searchResult?.thumbnailUrl || '');

	let version = $derived(
		(searchResult
			? SearchResult.getLatestFile(searchResult, channelType)?.version
			: addon?.installedVersion) ?? ''
	);

	let thumbnailLetter = $derived(
		listItem?.thumbnailLetter ?? searchResult?.name?.charAt(0).toUpperCase() ?? ''
	);

	let fundingLinks = $derived(addon?.fundingLinks ?? []);
	let missingDependencies = $derived(addon?.missingDependencies ?? []);
	let isUnknownProvider = $derived(addon?.providerName === ADDON_PROVIDER_UNKNOWN);

	let dependencies = $derived(
		searchResult
			? SearchResult.getDependencyType(searchResult, channelType, AddonDependencyType.Required)
			: (listItem?.getDependencies(AddonDependencyType.Required) ?? [])
	);

	let fullExternalId = $derived((searchResult ? searchResult.externalId : addon?.externalId) ?? '');

	// GitHub ids are "owner/repo"; the header only has room for the tail.
	let displayExternalId = $derived(
		fullExternalId.includes('/') ? `...${fullExternalId.split('/').at(-1) ?? ''}` : fullExternalId
	);

	let screenshots = $derived(addon?.screenshotUrls ?? searchResult?.screenshotUrls ?? []);

	let canShowChangelog = $derived(
		addonProviders.canShowChangelog(addon?.providerName ?? searchResult?.providerName ?? '')
	);

	let showInstallButton = $derived(!!searchResult);
	let showUpdateButton = $derived(!!listItem);

	// ---- async content --------------------------------------------------------------------

	// undefined until the "keep last tab" preference resolves — the Angular template gated the
	// whole <mat-tab-group> on `selectedTabIndex != undefined` for the same reason.
	let activeTab = $state<DetailsTabType | undefined>(undefined);

	let visibleTabs = $derived([
		'description' as const,
		...(canShowChangelog ? ['changelog' as const] : []),
		...(screenshots.length > 0 ? ['previews' as const] : [])
	]);

	async function loadChangelog(): Promise<string> {
		const installation = session.getSelectedWowInstallation();
		if (!installation) {
			console.warn('No selected installation');
			return '';
		}

		if (listItem?.addon) {
			return await addonService.getChangelogForAddon(installation, listItem.addon);
		}
		if (searchResult) {
			return await addonService.getChangelogForSearchResult(
				installation,
				channelType,
				searchResult
			);
		}
		return '';
	}

	async function loadDescription(): Promise<string> {
		const externalId = searchResult?.externalId ?? addon?.externalId ?? '';
		const providerName = searchResult?.providerName ?? addon?.providerName ?? '';

		try {
			// GitHub has no description endpoint; the summary is all there is.
			if (providerName === ADDON_PROVIDER_GITHUB) {
				if (addon?.summary) return addon.summary;
				throw new Error('Invalid model list item addon');
			}

			const installation = session.getSelectedWowInstallation();
			if (!installation) throw new Error('No selected installation');

			const result = await addonService.getFullDescription(
				installation,
				providerName,
				externalId,
				addon
			);
			return result || t('DIALOGS.ADDON_DETAILS.DESCRIPTION_NOT_FOUND');
		} catch {
			return '';
		}
	}

	async function isAddonInstalled(): Promise<boolean> {
		const installation = session.getSelectedWowInstallation();
		if (!installation) {
			console.warn('No selected installation');
			return false;
		}

		const externalId = searchResult?.externalId ?? addon?.externalId ?? '';
		const providerName = searchResult?.providerName ?? addon?.providerName ?? '';
		if (!externalId || !providerName) {
			console.warn('Invalid list item addon when verifying if installed');
			return false;
		}

		return await addonService.isInstalled(externalId, providerName, installation);
	}

	function initialTab(keepLast: boolean): DetailsTabType {
		if (!keepLast) return 'description';
		const last = session.getSelectedDetailsTab();
		// The previews tab may not exist for this addon.
		return visibleTabs.includes(last) ? last : 'description';
	}

	// Was ngOnInit + ngAfterViewInit, which split this across two lifecycle hooks only because
	// the changelog fetch needed the view to exist first. Nothing here touches the DOM.
	//
	// Four independent fetches previously shared one `cancelled` flag and each wrote a pair of
	// variables — the value and its own `fetching` boolean. As resources the loading flag is
	// the resource's, and each one re-runs on its own when `model` changes rather than all four
	// being re-triggered by a single effect.
	//
	// No `initialValue` on these two, deliberately: runed starts `loading` false when an initial
	// value is supplied, which would flash the empty state before the first fetch begins. The
	// originals started their `fetching` flags at true for the same reason.
	const changelogResource = resource(
		() => model,
		() => loadChangelog().catch(() => '')
	);

	const descriptionResource = resource(() => model, loadDescription);

	const installedResource = resource(
		() => model,
		() => isAddonInstalled().catch(() => false),
		{ initialValue: false }
	);

	let changelog = $derived(changelogResource.current ?? '');
	let description = $derived(descriptionResource.current ?? '');
	let showRemoveButton = $derived(installedResource.current);
	let fetchingChangelog = $derived(changelogResource.loading);
	let fetchingDescription = $derived(descriptionResource.loading);

	// Not a resource: this reads a preference once to pick the opening tab, and thereafter the
	// user owns the value. A resource would reset their choice on every dependency change.
	$effect(() => {
		let cancelled = false;
		void wowup
			.getKeepLastAddonDetailTab()
			.catch(() => false)
			.then((keepLast) => {
				if (!cancelled) activeTab = initialTab(keepLast);
			});
		return () => {
			cancelled = true;
		};
	});

	// Was addonInstalled$.pipe(filter(isSameAddon)) — keeps the buttons and version in sync
	// while an install runs with the dialog open.
	$effect(() =>
		onAddonInstalled((evt) => {
			const sameAddon =
				evt.addon.id === listItem?.addon?.id || evt.addon.externalId === searchResult?.externalId;
			if (!sameAddon) return;

			installedAddon = evt.addon;

			// The grid row holds this same AddonViewModel, so keep mutating it too.
			if (listItem) {
				listItem.addon = evt.addon;
				listItem.installState = evt.installState;
			}
		})
	);

	// ---- actions ---------------------------------------------------------------------------

	async function onSelectTab(tab: DetailsTabType) {
		activeTab = tab;
		await session.setSelectedDetailsTab(tab);
	}

	async function onClickExternalId() {
		await clipboard.writeText(fullExternalId);
		snackbar.showSuccess('DIALOGS.ADDON_DETAILS.COPY_ADDON_ID_SNACKBAR', { timeout: 2000 });
	}

	async function onClickRemoveAddon() {
		let target: Addon | undefined;

		if (currentPath(page.route?.id) === ROUTES.myAddons) {
			// Browsing My Addons — the addon is already on the model.
			if (typeof addon?.name !== 'string' || addon.name.length === 0) {
				console.warn('Invalid model list item addon');
				return;
			}
			target = addon;
		} else {
			const installation = session.getSelectedWowInstallation();
			const externalId = searchResult?.externalId ?? '';
			const providerName = searchResult?.providerName ?? '';

			if (!externalId || !providerName || !installation) {
				console.warn('Invalid search result when identifying which addon to remove', {
					installation,
					externalId,
					providerName
				});
				return;
			}
			target = await addonService.getByExternalId(externalId, providerName, installation.id);
		}

		if (!target) {
			console.warn('Invalid addon when attempting removal');
			return;
		}

		const result = await handleRemoveAddon(target);
		if (result.removed) onclose();
	}
</script>

<dialog class="wu-dialog addon-detail" {@attach modalDialog()} {onclose}>
	<div class="detail-header">
		<button
			type="button"
			class="icon bg-secondary-4"
			title={t('DIALOGS.ADDON_DETAILS.ADDON_ID_PREFIX') + displayExternalId}
			onclick={onClickExternalId}
		>
			{#if imageUrl}
				<img class="image" src={imageUrl} alt="" />
			{:else}
				<div class="text-3">{thumbnailLetter}</div>
			{/if}
		</button>

		<div class="heading">
			<h2 class="title">{title}</h2>
			<h3>{t('DIALOGS.ADDON_DETAILS.BY_AUTHOR', { authorName: subtitle })}</h3>
			<h4 class="text-2">{version}</h4>
		</div>

		<button type="button" class="close-icon" aria-label={t('COMMON.CLOSE')} onclick={onclose}>
			<Icon name="fas:xmark" size="1.25em" />
		</button>
	</div>

	<div class="dialog-content">
		{#if fundingLinks.length > 0}
			<div class="funding-link-container">
				<h3>{t('DIALOGS.ADDON_DETAILS.FUNDING_LINK_TITLE')}</h3>
				<div class="funding-row">
					{#each fundingLinks as link (link.url)}
						<FundingButton funding={link} />
					{/each}
				</div>
			</div>
		{/if}

		{#if isUnknownProvider && missingDependencies.length > 0}
			<div>
				<h3>{t('DIALOGS.ADDON_DETAILS.MISSING_DEPENDENCIES')}</h3>
				<ul>
					{#each missingDependencies as dependency (dependency)}
						<li>{dependency}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if dependencies.length > 0}
			<div class="addon-dependencies bg-secondary-4 text-1">
				<Icon name="fas:link" />
				<span>
					{t('DIALOGS.ADDON_DETAILS.DEPENDENCY_TEXT', { dependencyCount: dependencies.length })}
				</span>
			</div>
		{/if}

		{#if activeTab !== undefined && !isUnknownProvider}
			<div class="detail-tabs">
				<div class="tab-list" role="tablist">
					{#each visibleTabs as tab (tab)}
						<button
							type="button"
							role="tab"
							class="tab-trigger"
							class:active={activeTab === tab}
							aria-selected={activeTab === tab}
							onclick={() => onSelectTab(tab)}
						>
							{#if tab === 'description'}
								{t('DIALOGS.ADDON_DETAILS.DESCRIPTION_TAB')}
							{:else if tab === 'changelog'}
								{t('DIALOGS.ADDON_DETAILS.CHANGELOG_TAB')}
							{:else}
								{t('DIALOGS.ADDON_DETAILS.IMAGES_TAB')}
							{/if}
						</button>
					{/each}
				</div>

				<div class="tab-panel scroller" role="tabpanel">
					{#if activeTab === 'description'}
						{#if fetchingDescription}
							<ProgressSpinner />
						{:else}
							<!-- Provider-supplied HTML, sanitised by the provider before it gets here —
							     same trust boundary as the Angular [innerHtml] binding. -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							<div class="markdown-body addon-summary text-1 selectable">{@html description}</div>
						{/if}
					{:else if activeTab === 'changelog'}
						{#if fetchingChangelog}
							<ProgressSpinner />
						{:else if changelog.length === 0}
							<div>{t('DIALOGS.ADDON_DETAILS.NO_CHANGELOG_TEXT')}</div>
						{:else}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							<div class="markdown-body addon-changelog text-1 selectable">{@html changelog}</div>
						{/if}
					{:else}
						<ImageGallery images={screenshots} />
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if !isUnknownProvider}
		<div class="dialog-actions">
			{#if showRemoveButton}
				<button class="wu-btn wu-btn-flat wu-btn-warning" onclick={onClickRemoveAddon}>
					{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.REMOVE_ADDON_BUTTON')}
				</button>
			{/if}

			<div class="spacer"></div>

			{#if externalUrl !== 'UNKNOWN'}
				<button
					class="wu-btn wu-btn-flat text-1"
					title={t('DIALOGS.ADDON_DETAILS.VIEW_IN_BROWSER_BUTTON')}
					onclick={() => void openExternalLink(externalUrl)}
				>
					{t('DIALOGS.ADDON_DETAILS.VIEW_ON_PROVIDER_PREFIX')}
					{provider}
				</button>
			{/if}

			{#if showInstallButton && searchResult}
				<AddonInstallButton addonSearchResult={searchResult} />
			{/if}
			{#if showUpdateButton && listItem}
				<AddonUpdateButton {listItem} />
			{/if}
		</div>
	{/if}
</dialog>

<style>
	/* MatDialog opened this with no explicit width, so it sized to content under the default
	   maxWidth: 80vw — and `.markdown-body` caps at 979px, which is what set the width in
	   practice. Pinning it to 46rem here made the dialog noticeably narrower than the original
	   and rewrapped every description. */
	.addon-detail {
		width: auto;
		min-width: 32rem;
		max-width: 80vw;
	}

	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding-bottom: 0.5rem;
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 64px;
		height: 64px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
		overflow: hidden;
	}

	.image {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.heading {
		flex: 1 1 auto;
		min-width: 0;
	}

	.heading h2,
	.heading h3,
	.heading h4 {
		margin: 0;
	}

	.title {
		word-break: break-word;
	}

	.close-icon {
		flex: none;
		padding: 0.25rem;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.funding-link-container {
		padding: 0.25rem;
	}

	.funding-link-container h3 {
		margin: 0;
	}

	.funding-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.addon-dependencies {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 4px;
	}

	.detail-tabs {
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin-top: 0.75rem;
	}

	/* <mat-tab-group> spread its labels across the full width and left them title-case; the
	   active one got a tinted block plus an accent underline. Uppercasing them here was a
	   stylistic invention that made the dialog read differently from the rest of the app. */
	.tab-list {
		display: flex;
		border-bottom: 1px solid var(--overlay-selected);
	}

	.tab-trigger {
		flex: 1;
		padding: 0.75rem 1rem;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--text-2);
		font: inherit;
		cursor: pointer;
	}

	.tab-trigger:hover:not(.active) {
		background: var(--overlay-hover);
	}

	.tab-trigger.active {
		border-bottom-color: var(--background-primary);
		background: var(--overlay-subtle);
		color: var(--text-1);
	}

	.tab-panel {
		min-height: 12rem;
		max-height: 50vh;
		overflow-y: auto;
		padding-top: 0.5rem;
	}

	.dialog-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.75rem;
	}

	.spacer {
		flex: 1 1 auto;
	}

	.selectable {
		user-select: text;
	}
</style>
