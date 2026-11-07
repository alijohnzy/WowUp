<script lang="ts">
	// Port of components/common/footer (310 LOC).
	//
	// Removed: NgZone (the app-update events arrive from IPC, so the Angular version wrapped
	// every state change in `_zone.run()`), three Observables built with combineLatest, and
	// the [ngSwitch]/*ngSwitchCase ladder over the update state.

	import { AppUpdateState } from '$common/wowup/models';
	import { AppConfig } from '$config/environment';
	import { i18n, t } from '$lib/i18n.svelte';
	import { versionLabel } from '$lib/utils/app-version';
	import { isTauri } from '$lib/ipc';
	import Icon from './Icon.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import { installAvailableUpdate } from '$lib/services/app-update';
	import {
		EARLIER_VERSION_KEY,
		earlierVersionLabel,
		installEarlierVersion,
		listEarlierVersions,
		type EarlierVersion,
		type EarlierVersions
	} from '$lib/services/earlier-versions';
	import { electron } from '$lib/state/electron.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wowup } from '$lib/state/wowup.svelte';

	let updateState = $derived(electron.appUpdate?.state);
	let updateProgress = $derived(
		(electron.appUpdate?.progress as { percent?: number } | undefined)?.percent ?? 0
	);

	// Tauri asks before downloading (src-tauri/src/updater.rs): UpdateAvailable is a button,
	// where Electron, which downloads straight away, only showed it as a passing state.
	let availableVersion = $derived(electron.appUpdate?.version ?? '');

	const onUpdateAvailable = installAvailableUpdate;

	// A check the user asked for gets an answer. The hourly ones stay quiet, but a click that
	// finds nothing left the footer exactly as it was, so the button looked dead.
	let manualCheck = false;

	function onCheckForUpdate(): void {
		manualCheck = true;
		wowup.checkForAppUpdate();
	}

	$effect(() => {
		const evt = electron.appUpdate;
		if (!evt || !manualCheck) return;
		if (evt.state === AppUpdateState.CheckingForUpdate) return;
		manualCheck = false;
		if (evt.state === AppUpdateState.UpdateNotAvailable) {
			snackbar.show(
				evt.localBuild
					? 'APP.WOWUP_UPDATE.LOCAL_BUILD_NO_UPDATES'
					: 'APP.WOWUP_UPDATE.NOT_AVAILABLE'
			);
		}
		// UpdateAvailable shows its button; errors already get a snackbar from the layout.
	});

	let version = $derived(versionLabel(session.appVersion ?? '', session.buildCommit));

	// Right-click on the update button: earlier versions to go back to (services/earlier-versions.ts).
	let versionsMenu = $state<{ x: number; y: number }>();
	let earlier = $state<EarlierVersions>();
	let earlierError = $state('');

	function onUpdateSlotContextMenu(event: MouseEvent) {
		if (!isTauri()) return;
		event.preventDefault();
		versionsMenu = { x: event.clientX, y: event.clientY };
		earlierError = '';
		listEarlierVersions().then(
			(result) => (earlier = result),
			(e: unknown) => (earlierError = String(e))
		);
	}

	async function onPickEarlierVersion(v: EarlierVersion) {
		versionsMenu = undefined;
		try {
			await installEarlierVersion(v, earlier?.canInstall ?? false);
		} catch (e) {
			console.error('install earlier version failed', e);
		}
	}

	$effect(() => {
		if (session.appVersion === undefined) {
			session.loadAppVersion().catch((e: unknown) => console.error('app version failed', e));
		}
	});
</script>

<footer class="bg-secondary-3 text-2">
	<p class="text-1 status">{session.statusText}</p>
	<div class="spacer"></div>
	<p class="context">{session.pageContextText}</p>
	<p
		title={version.localCommit
			? i18n.t('APP.VERSION.LOCAL_BUILD_TOOLTIP', { commit: version.localCommit })
			: undefined}
	>
		v{version.text}
		{AppConfig.curseforge.enabled ? 'CF' : ''}
	</p>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="update-slot" oncontextmenu={onUpdateSlotContextMenu}>
		{#if updateState === AppUpdateState.CheckingForUpdate}
			<p>{t('APP.WOWUP_UPDATE.CHECKING_FOR_UPDATE')}</p>
		{:else if updateState === AppUpdateState.UpdateAvailable && isTauri()}
			<button
				class="footer-button update-button text-1"
				title={`${t('APP.WOWUP_UPDATE.TOOLTIP')} (v${availableVersion})`}
				onclick={() => void onUpdateAvailable()}
			>
				<Icon name="fas:rotate" />
				{t('APP.WOWUP_UPDATE.SNACKBAR_ACTION')}
			</button>
		{:else if updateState === AppUpdateState.UpdateAvailable}
			<p>{t('APP.WOWUP_UPDATE.UPDATE_AVAILABLE')}</p>
		{:else if updateState === AppUpdateState.Downloading}
			<div class="downloading">
				<progress max="100" value={updateProgress}></progress>
				<span>{t('APP.WOWUP_UPDATE.DOWNLOADING_UPDATE')}</span>
			</div>
		{:else if updateState === AppUpdateState.Downloaded}
			<button
				class="footer-button update-button text-1"
				title={t('APP.WOWUP_UPDATE.TOOLTIP')}
				onclick={() => wowup.installUpdate()}
			>
				<Icon name="fas:rotate" />
				{t('APP.WOWUP_UPDATE.SNACKBAR_ACTION')}
			</button>
		{:else}
			<button
				class="footer-button text-1"
				title={t('APP.SYSTEM_TRAY.CHECK_UPDATE')}
				aria-label={t('APP.SYSTEM_TRAY.CHECK_UPDATE')}
				onclick={onCheckForUpdate}
			>
				<Icon name="fas:rotate" />
			</button>
		{/if}
	</div>
</footer>

{#if versionsMenu}
	<ContextMenu x={versionsMenu.x} y={versionsMenu.y} onclose={() => (versionsMenu = undefined)}>
		<div class="menu-header">{t(`${EARLIER_VERSION_KEY}.LABEL`)}</div>
		{#if earlier?.localBuild}
			<p class="menu-note text-2">{t(`${EARLIER_VERSION_KEY}.LOCAL_BUILD`)}</p>
		{:else if earlierError}
			<p class="menu-note text-warning">
				{i18n.t(`${EARLIER_VERSION_KEY}.LOAD_FAILED`, { error: earlierError })}
			</p>
		{:else if !earlier}
			<p class="menu-note text-2">{t(`${EARLIER_VERSION_KEY}.LOADING`)}</p>
		{:else if earlier.versions.length === 0}
			<p class="menu-note text-2">{t(`${EARLIER_VERSION_KEY}.NONE`)}</p>
		{:else}
			{#each earlier.versions as v (v.tag)}
				<button class="menu-item" onclick={() => void onPickEarlierVersion(v)}>
					{earlierVersionLabel(v)}
				</button>
			{/each}
		{/if}
	</ContextMenu>
{/if}

<style>
	.menu-note {
		max-width: 260px;
		margin: 0;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: none;
		height: 28px;
		padding: 0 0.75rem;
		font-size: 0.75rem;
	}

	footer p {
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status,
	.context {
		max-width: 40%;
	}

	.spacer {
		flex: 1;
	}

	.update-slot {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.downloading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	progress {
		width: 60px;
		height: 6px;
	}

	.footer-button {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 0 0.25rem;
	}

	.footer-button:hover {
		opacity: 0.8;
	}
</style>
