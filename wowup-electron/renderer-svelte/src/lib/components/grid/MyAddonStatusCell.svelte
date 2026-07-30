<script lang="ts">
	// Port of components/addons/my-addon-status-cell (156 LOC).
	//
	// Removed: NgZone (install events arrive over IPC, so every update was wrapped in
	// `_ngZone.run()`), a takeUntil(destroy$) subscription, and MatDialog.

	import type { ICellRendererParams } from 'ag-grid-community';
	import { AddonWarningType, type Addon } from 'wowup-lib-core';
	import { AddonInstallState } from '$lib/models/addon-install-state';
	import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
	import type { AddonViewModel } from '$lib/business-objects/addon-view-model';
	import { t, i18n } from '$lib/i18n.svelte';
	import * as addonUtils from '$lib/utils/addon';
	import AddonUpdateButton from '$lib/components/addons/AddonUpdateButton.svelte';
	import { onAddonInstalled } from '$lib/state/addon.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';

	interface Props {
		params: ICellRendererParams;
	}

	let { params }: Props = $props();

	let listItem = $derived(params.data as AddonViewModel);
	let warningType = $derived(listItem?.addon?.warningType);

	// GameVersionTocMissing is deliberately not surfaced as a warning badge.
	let hasWarning = $derived(
		warningType !== undefined && warningType !== AddonWarningType.GameVersionTocMissing
	);

	let installState = $state<AddonInstallState | undefined>(undefined);
	let liveShowStatusText = $state<boolean | undefined>(undefined);

	let showStatusText = $derived(
		liveShowStatusText ?? (listItem?.isUpToDate() || (listItem?.addon?.isIgnored ?? true))
	);

	function getStatusText(
		addon: Addon | undefined,
		state: AddonInstallState = AddonInstallState.Unknown
	): string {
		if (!addon) return '';
		if (addon.isIgnored) return 'COMMON.ADDON_STATE.IGNORED';
		if (state === AddonInstallState.Pending) return 'COMMON.ADDON_STATE.PENDING';
		if (!addonUtils.needsUpdate(addon)) return 'COMMON.ADDON_STATE.UPTODATE';
		return listItem.stateTextTranslationKey;
	}

	let statusText = $derived(getStatusText(listItem?.addon, installState));

	$effect(() =>
		onAddonInstalled((evt: AddonUpdateEvent) => {
			if (
				evt.addon.externalId !== listItem?.addon?.externalId ||
				evt.addon.providerName !== listItem?.addon?.providerName
			) {
				return;
			}

			installState = evt.installState;
			liveShowStatusText =
				evt.installState !== AddonInstallState.Complete
					? false
					: !addonUtils.needsUpdate(evt.addon) || (listItem?.addon?.isIgnored ?? true);
		})
	);

	function warningDescriptionKey(): string {
		switch (warningType) {
			case AddonWarningType.MissingOnProvider:
				return 'COMMON.ADDON_WARNING.MISSING_ON_PROVIDER_DESCRIPTION';
			case AddonWarningType.NoProviderFiles:
				return 'COMMON.ADDON_WARNING.NO_PROVIDER_FILES_DESCRIPTION';
			case AddonWarningType.TocNameMismatch:
				return 'COMMON.ADDON_WARNING.TOC_NAME_MISMATCH_DESCRIPTION';
			case AddonWarningType.GameVersionTocMissing:
				return 'COMMON.ADDON_WARNING.GAME_VERSION_TOC_MISSING_DESCRIPTION';
			default:
				return 'COMMON.ADDON_WARNING.GENERIC_DESCRIPTION';
		}
	}

	async function onWarningButton() {
		await dialogs.alert({
			title: t('COMMON.ADDON_STATE.WARNING'),
			message: i18n.t(warningDescriptionKey(), { providerName: listItem.providerName })
		});
	}
</script>

<div class="status-row">
	{#if hasWarning}
		<button class="wu-btn wu-btn-flat wu-btn-warning" onclick={() => void onWarningButton()}>
			{t('COMMON.ADDON_STATE.WARNING')}
		</button>
	{:else if showStatusText}
		<div class="status-text" class:ignored={listItem?.addon?.isIgnored}>{t(statusText)}</div>
	{:else}
		<AddonUpdateButton {listItem} onViewUpdated={() => params.api?.resetRowHeights()} />
	{/if}
</div>

<style>
	.status-row {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.status-text.ignored {
		opacity: 0.6;
	}
</style>
