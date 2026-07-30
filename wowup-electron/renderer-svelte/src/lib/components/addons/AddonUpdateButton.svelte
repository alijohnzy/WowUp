<script lang="ts">
	// Port of components/addons/addon-update-button (183 LOC).
	//
	// Removed: a Subscription array + ngOnDestroy, and ChangeDetectorRef (install events
	// arrive over IPC, so the Angular version called detectChanges() after every update and
	// again inside the error-reset timeout).

	import { ADDON_PROVIDER_UNKNOWN } from '$common/constants';
	import { AddonInstallState } from '$lib/models/addon-install-state';
	import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
	import type { AddonViewModel } from '$lib/business-objects/addon-view-model';
	import { t } from '$lib/i18n.svelte';
	import ProgressButton from '$lib/components/common/ProgressButton.svelte';
	import { addonService, onAddonInstalled } from '$lib/state/addon.svelte';

	interface Props {
		listItem: AddonViewModel;
		/** Lets an owning grid re-measure its row after the button changes size. */
		onViewUpdated?: () => void;
	}

	let { listItem, onViewUpdated }: Props = $props();

	let installState = $state(AddonInstallState.Unknown);
	let installProgress = $state(0);

	let providerName = $derived(listItem.addon?.providerName ?? '');
	let externalId = $derived(listItem.addon?.externalId ?? '');

	let isButtonActive = $derived(
		installState !== AddonInstallState.Unknown &&
			installState !== AddonInstallState.Complete &&
			installState !== AddonInstallState.Error
	);

	let isButtonDisabled = $derived(
		listItem.isUpToDate() || installState < AddonInstallState.Unknown
	);

	function installStateText(state: AddonInstallState): string {
		switch (state) {
			case AddonInstallState.BackingUp:
				return t('COMMON.ADDON_STATUS.BACKINGUP');
			case AddonInstallState.Complete:
				return t('COMMON.ADDON_STATE.UPTODATE');
			case AddonInstallState.Downloading:
				return t('COMMON.ADDON_STATUS.DOWNLOADING');
			case AddonInstallState.Installing:
				return t('COMMON.ADDON_STATUS.INSTALLING');
			case AddonInstallState.Pending:
				return t('COMMON.ADDON_STATUS.PENDING');
			case AddonInstallState.Error:
				return t('COMMON.ADDON_STATUS.ERROR');
			case AddonInstallState.Retry:
				return t('COMMON.ADDON_STATUS.RETRY');
			default:
				return '';
		}
	}

	function statusText(): string {
		if (listItem.needsInstall()) return t('PAGES.MY_ADDONS.TABLE.ADDON_INSTALL_BUTTON');
		if (listItem.needsUpdate()) return t('PAGES.MY_ADDONS.TABLE.ADDON_UPDATE_BUTTON');
		return t(listItem.stateTextTranslationKey);
	}

	let buttonText = $derived(
		installState !== AddonInstallState.Unknown ? installStateText(installState) : statusText()
	);

	// Seed from any install already in flight for this addon.
	$effect(() => {
		if (listItem.addon?.providerName === ADDON_PROVIDER_UNKNOWN) return;
		if (!listItem.addon?.id || !listItem.addon.externalId || !listItem.addon.providerName) {
			console.warn('Invalid list item addon', listItem);
			return;
		}

		const status = addonService.getInstallStatus(listItem.addon.id);
		if (status) {
			installProgress = status.progress;
			installState = status.installState;
		}
	});

	$effect(() => {
		let resetTimer: ReturnType<typeof setTimeout> | undefined;

		const off = onAddonInstalled((evt: AddonUpdateEvent) => {
			if (evt.addon.externalId !== externalId || evt.addon.providerName !== providerName) return;

			installState = evt.installState;
			installProgress = evt.progress;

			// An error state clears itself after 2s so the row returns to its normal action.
			if (installState === AddonInstallState.Error) {
				clearTimeout(resetTimer);
				resetTimer = setTimeout(() => {
					if (installState === AddonInstallState.Error) {
						installState = AddonInstallState.Unknown;
						installProgress = 0;
					}
				}, 2000);
			}

			onViewUpdated?.();
		});

		return () => {
			clearTimeout(resetTimer);
			off();
		};
	});

	async function onInstallUpdateClick() {
		try {
			if (listItem.addon?.id === undefined) throw new Error('Invalid list item addon');

			if (listItem.needsUpdate()) await addonService.updateAddon(listItem.addon);
			else await addonService.installAddon(listItem.addon);
		} catch (e) {
			console.error(e);
		}
	}
</script>

<ProgressButton
	value={installProgress}
	showProgress={isButtonActive}
	disable={isButtonDisabled}
	onclick={() => void onInstallUpdateClick()}
>
	{buttonText}
</ProgressButton>
