<script lang="ts">
	// Port of components/addons/addon-install-button (144 LOC).
	//
	// Removed: 5 BehaviorSubjects, a takeUntil(destroy$) subscription, ChangeDetectorRef
	// (the install events arrive over IPC, so every update needed detectChanges()), and the
	// @Output() EventEmitter — now an `onViewUpdated` callback prop.

	import { AddonInstallState } from '$lib/models/addon-install-state';
	import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
	import { t } from '$lib/i18n.svelte';
	import ProgressButton from '$lib/components/common/ProgressButton.svelte';
	import { addonService, onAddonInstalled } from '$lib/state/addon.svelte';
	import { session } from '$lib/state/session.svelte';
	import type { AddonSearchResult } from 'wowup-lib-core';

	interface Props {
		addonSearchResult: AddonSearchResult;
		/** Lets an owning grid re-measure its row after the button changes size. */
		onViewUpdated?: () => void;
	}

	let { addonSearchResult, onViewUpdated }: Props = $props();

	let installState = $state(AddonInstallState.Unknown);
	let progressValue = $state(0);
	let isInstalled = $state(false);
	let clicked = $state(false);

	let showProgress = $derived(
		installState !== AddonInstallState.Unknown && installState !== AddonInstallState.Complete
	);

	let disableButton = $derived(
		addonSearchResult.externallyBlocked ||
			isInstalled ||
			clicked ||
			installState !== AddonInstallState.Unknown
	);

	function installStateText(state: AddonInstallState): string {
		switch (state) {
			case AddonInstallState.BackingUp:
				return t('COMMON.ADDON_STATUS.BACKINGUP');
			case AddonInstallState.Complete:
				return t('COMMON.ADDON_STATUS.COMPLETE');
			case AddonInstallState.Downloading:
				return t('COMMON.ADDON_STATUS.DOWNLOADING');
			case AddonInstallState.Installing:
				return t('COMMON.ADDON_STATUS.INSTALLING');
			case AddonInstallState.Pending:
				return t('COMMON.ADDON_STATUS.PENDING');
			default:
				return '';
		}
	}

	let buttonText = $derived.by(() => {
		if (addonSearchResult.externallyBlocked) return t('COMMON.ADDON_STATE.UNAVAILABLE');
		if (installState !== AddonInstallState.Unknown) return installStateText(installState);
		if (isInstalled) return installStateText(AddonInstallState.Complete);
		return t('COMMON.ADDON_STATE.INSTALL');
	});

	$effect(() => {
		const installation = session.getSelectedWowInstallation();
		if (!installation) {
			console.warn('No selected installation');
			return;
		}

		addonService
			.isInstalled(addonSearchResult.externalId, addonSearchResult.providerName, installation)
			.then((installed) => (isInstalled = installed))
			.catch((e: unknown) => console.error(e));
	});

	$effect(() =>
		onAddonInstalled((evt: AddonUpdateEvent) => {
			// Only react to events for this search result.
			if (
				evt.addon.externalId !== addonSearchResult.externalId ||
				evt.addon.providerName !== addonSearchResult.providerName
			) {
				return;
			}

			installState = evt.installState;
			progressValue = evt.progress;
			onViewUpdated?.();
		})
	);

	async function onInstallClick() {
		const installation = session.getSelectedWowInstallation();
		if (!installation) {
			console.warn('No selected installation');
			return;
		}

		clicked = true;
		try {
			await addonService.installPotentialAddon(addonSearchResult, installation);
		} catch (e) {
			console.error('onInstallUpdateClick failed', e);
			console.error(addonSearchResult);
			clicked = false;
		}
	}
</script>

<ProgressButton
	value={progressValue}
	{showProgress}
	disable={disableButton}
	onclick={() => void onInstallClick()}
>
	{buttonText}
</ProgressButton>
