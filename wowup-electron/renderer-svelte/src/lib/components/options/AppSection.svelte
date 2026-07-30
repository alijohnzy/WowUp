<script lang="ts">
	// Port of components/options/options-app-section (760 LOC) — the largest Options screen.
	//
	// Removed: 11 BehaviorSubjects (each initialised by its own `.then(v => subj.next(v))`
	// block in ngOnInit — ~90 lines that become one loader), ChangeDetectorRef, and the
	// MatSlideToggleChange/MatSelectChange event plumbing.
	//
	// Five settings share a "confirm, else put the control back" shape. In Angular each was
	// its own switchMap chain that reached into `evt.source.checked` to revert the widget.
	// Here `confirmOrRevert` states that rule once and the caller just awaits it.

	import {
		ALLIANCE_LIGHT_THEME,
		ALLIANCE_THEME,
		APP_PROTOCOL_NAME,
		CURSE_PROTOCOL_NAME,
		DEFAULT_LIGHT_THEME,
		DEFAULT_THEME,
		HORDE_LIGHT_THEME,
		HORDE_THEME,
		IPC_RESTART_APP
	} from '$common/constants';
	import { WowUpReleaseChannelType } from '$common/wowup/wowup-release-channel-type';
	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import { invoke, isWin } from '$lib/ipc';
	import type { ThemeGroup } from '$lib/models/theme';
	import { getTelemetryEnabled, setTelemetryEnabled } from '$lib/services/analytics';
	import Toggle from '$lib/components/common/Toggle.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { electron } from '$lib/state/electron.svelte';
	import { theme } from '$lib/state/theme.svelte';
	import { wowup } from '$lib/state/wowup.svelte';
	import { ZOOM_SCALE, zoom } from '$lib/state/zoom.svelte';

	const LANGUAGES = [
		{ localeId: 'en', label: 'English' },
		{ localeId: 'cs', label: 'Čestina' },
		{ localeId: 'de', label: 'Deutsch' },
		{ localeId: 'es', label: 'Español' },
		{ localeId: 'fr', label: 'Français' },
		{ localeId: 'it', label: 'Italiano' },
		{ localeId: 'pl', label: 'Polski' },
		{ localeId: 'ko', label: '한국어' },
		{ localeId: 'nb', label: 'Norsk Bokmål' },
		{ localeId: 'pt', label: 'Português' },
		{ localeId: 'ru', label: 'русский' },
		{ localeId: 'zh', label: '简体中文' },
		{ localeId: 'zh-TW', label: '繁體中文' }
	];

	const THEME_GROUPS: ThemeGroup[] = [
		{
			name: 'APP.THEME.GROUP_DARK',
			themes: [
				{ display: 'APP.THEME.DEFAULT', class: DEFAULT_THEME },
				{ display: 'APP.THEME.ALLIANCE', class: ALLIANCE_THEME },
				{ display: 'APP.THEME.HORDE', class: HORDE_THEME }
			]
		},
		{
			name: 'APP.THEME.GROUP_LIGHT',
			themes: [
				{ display: 'APP.THEME.DEFAULT', class: DEFAULT_LIGHT_THEME },
				{ display: 'APP.THEME.ALLIANCE', class: ALLIANCE_LIGHT_THEME },
				{ display: 'APP.THEME.HORDE', class: HORDE_LIGHT_THEME }
			]
		}
	];

	const RELEASE_CHANNELS = [
		{ value: WowUpReleaseChannelType.Stable, labelKey: 'COMMON.ENUM.ADDON_CHANNEL_TYPE.STABLE' },
		{ value: WowUpReleaseChannelType.Beta, labelKey: 'COMMON.ENUM.ADDON_CHANNEL_TYPE.BETA' }
	];

	// Was eleven BehaviorSubjects.
	let enableSystemNotifications = $state(false);
	let currentLanguage = $state('en');
	let useSymlinkMode = $state(false);
	let useHardwareAcceleration = $state(true);
	let telemetryEnabled = $state(false);
	let collapseToTray = $state(false);
	let enableAppBadge = $state(false);
	let startWithSystem = $state(false);
	let startMinimized = $state(false);
	let keepAddonDetailTab = $state(false);
	let currentReleaseChannel = $state(WowUpReleaseChannelType.Stable);

	let wowupProtocolHandled = $state(false);
	let curseforgeProtocolHandled = $state(false);

	let minimizeOnCloseDescription = $derived(
		isWin()
			? t('PAGES.OPTIONS.APPLICATION.MINIMIZE_ON_CLOSE_DESCRIPTION_WINDOWS')
			: t('PAGES.OPTIONS.APPLICATION.MINIMIZE_ON_CLOSE_DESCRIPTION_MAC')
	);

	// Replaces ~90 lines of independent `.then(v => subject.next(v))` blocks in ngOnInit.
	$effect(() => {
		void (async () => {
			try {
				[
					enableSystemNotifications,
					currentLanguage,
					useSymlinkMode,
					useHardwareAcceleration,
					collapseToTray,
					enableAppBadge,
					startWithSystem,
					startMinimized,
					keepAddonDetailTab
				] = await Promise.all([
					wowup.getEnableSystemNotifications(),
					wowup.getCurrentLanguage(),
					wowup.getUseSymlinkMode(),
					wowup.getUseHardwareAcceleration(),
					wowup.getCollapseToTray(),
					wowup.getEnableAppBadge(),
					wowup.getStartWithSystem(),
					wowup.getStartMinimized(),
					wowup.getKeepLastAddonDetailTab()
				]);

				currentReleaseChannel = await wowup.getWowUpReleaseChannel();
				telemetryEnabled = await getTelemetryEnabled();
				wowupProtocolHandled = await electron.isDefaultProtocolClient(APP_PROTOCOL_NAME);
				curseforgeProtocolHandled = await electron.isDefaultProtocolClient(CURSE_PROTOCOL_NAME);
			} catch (e) {
				console.error(e);
			}
		})();
	});

	/**
	 * Ask first; if the user declines, undo the optimistic change the bound control already
	 * made. Returns whether the change stuck.
	 */
	async function confirmOrRevert(
		titleKey: string,
		messageKey: string,
		revert: () => void,
		positiveKey?: string
	): Promise<boolean> {
		const confirmed = await dialogs.confirm({
			title: t(titleKey),
			message: t(messageKey),
			positiveKey
		});
		if (!confirmed) revert();
		return confirmed;
	}

	// ---- simple settings: persist, no confirmation ------------------------------------

	const onEnableSystemNotifications = (checked: boolean) =>
		void wowup.setEnableSystemNotifications(checked).catch(console.error);

	const onCollapseChange = (checked: boolean) =>
		void wowup.setCollapseToTray(checked).catch(console.error);

	const onStartWithSystemChange = (checked: boolean) =>
		void wowup.setStartWithSystem(checked).catch(console.error);

	const onStartMinimizedChange = (checked: boolean) =>
		void wowup.setStartMinimized(checked).catch(console.error);

	const onKeepAddonDetailTabChange = (checked: boolean) =>
		void wowup.setKeepLastAddonDetailTab(checked).catch(console.error);

	const onTelemetryChange = (checked: boolean) =>
		void setTelemetryEnabled(checked).catch(console.error);

	async function onToggleAppBadge(checked: boolean) {
		await wowup.setEnableAppBadge(checked);
		await wowup.updateAppBadgeCount(0);
	}

	async function onThemeChange(themeClass: string) {
		await theme.set(themeClass);
	}

	async function onScaleChange(scale: number) {
		await zoom.setZoomFactor(scale);
	}

	// ---- settings that confirm first ---------------------------------------------------

	async function onProtocolHandlerChange(protocol: string, checked: boolean) {
		const revert = () => {
			if (protocol === APP_PROTOCOL_NAME) wowupProtocolHandled = !checked;
			else curseforgeProtocolHandled = !checked;
		};

		// Turning it off needs no warning — only claiming the protocol can affect other apps.
		if (checked) {
			const ok = await confirmOrRevert(
				'PAGES.OPTIONS.APPLICATION.USE_CURSE_PROTOCOL_CONFIRMATION_LABEL',
				'PAGES.OPTIONS.APPLICATION.USE_CURSE_PROTOCOL_CONFIRMATION_DESCRIPTION',
				revert
			);
			if (!ok) return;
		}

		try {
			if (checked) await electron.setAsDefaultProtocolClient(protocol);
			else await electron.removeAsDefaultProtocolClient(protocol);
		} catch (e) {
			console.error(e);
			revert();
		}
	}

	async function onUseHardwareAccelerationChange(checked: boolean) {
		const ok = await confirmOrRevert(
			'PAGES.OPTIONS.APPLICATION.USE_HARDWARE_ACCELERATION_CONFIRMATION_LABEL',
			checked
				? 'PAGES.OPTIONS.APPLICATION.USE_HARDWARE_ACCELERATION_ENABLE_CONFIRMATION_DESCRIPTION'
				: 'PAGES.OPTIONS.APPLICATION.USE_HARDWARE_ACCELERATION_DISABLE_CONFIRMATION_DESCRIPTION',
			() => (useHardwareAcceleration = !checked)
		);
		if (!ok) return;

		try {
			await wowup.setUseHardwareAcceleration(checked);
			await invoke(IPC_RESTART_APP);
		} catch (e) {
			console.error(e);
		}
	}

	async function onSymlinkModeChange(checked: boolean) {
		if (!checked) {
			await wowup.setUseSymlinkMode(false);
			return;
		}

		const ok = await confirmOrRevert(
			'PAGES.OPTIONS.APPLICATION.USE_SYMLINK_SUPPORT_CONFIRMATION_LABEL',
			'PAGES.OPTIONS.APPLICATION.USE_SYMLINK_SUPPORT_CONFIRMATION_DESCRIPTION',
			() => (useSymlinkMode = false)
		);
		if (!ok) return;

		await wowup.setUseSymlinkMode(true).catch(console.error);
	}

	async function onReleaseChannelChange(channel: WowUpReleaseChannelType) {
		const previous = await wowup.getWowUpReleaseChannel();

		const ok = await confirmOrRevert(
			'PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_CONFIRMATION_LABEL',
			channel === WowUpReleaseChannelType.Beta
				? 'PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_CONFIRMATION_DESCRIPTION_BETA'
				: 'PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_CONFIRMATION_DESCRIPTION_STABLE',
			() => (currentReleaseChannel = previous),
			'PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_CONFIRMATION_POSITIVE_BUTTON'
		);
		if (!ok) return;

		await wowup.setWowUpReleaseChannel(channel).catch(console.error);
	}

	async function onCurrentLanguageChange(localeId: string) {
		const previous = await wowup.getCurrentLanguage();

		const ok = await confirmOrRevert(
			'PAGES.OPTIONS.APPLICATION.SET_LANGUAGE_CONFIRMATION_LABEL',
			'PAGES.OPTIONS.APPLICATION.SET_LANGUAGE_CONFIRMATION_DESCRIPTION',
			() => (currentLanguage = previous)
		);
		if (!ok) return;

		try {
			await wowup.setCurrentLanguage(localeId);
			await invoke(IPC_RESTART_APP);
		} catch (e) {
			console.error(e);
		}
	}
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.APPLICATION.TITLE')}</h2>

	<!-- APPEARANCE -->
	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.THEME_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.THEME_DESCRIPTION')}</small>
		</div>
		<label class="field">
			<select
				value={theme.current}
				onchange={(e) => void onThemeChange(e.currentTarget.value)}
				aria-label={t('PAGES.OPTIONS.APPLICATION.THEME_LABEL')}
			>
				{#each THEME_GROUPS as group (group.name)}
					<optgroup label={t(group.name)}>
						{#each group.themes as theme (theme.class)}
							<option value={theme.class}>{t(theme.display)}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.SET_LANGUAGE_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.SET_LANGUAGE_DESCRIPTION')}</small>
		</div>
		<label class="field">
			<select
				value={currentLanguage}
				onchange={(e) => void onCurrentLanguageChange(e.currentTarget.value)}
				aria-label={t('PAGES.OPTIONS.APPLICATION.CURRENT_LANGUAGE_LABEL')}
			>
				{#each LANGUAGES as language (language.localeId)}
					<option value={language.localeId}>{language.label}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.SCALE_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.SCALE_DESCRIPTION')}</small>
		</div>
		<label class="field">
			<select
				value={zoom.factor}
				onchange={(e) => void onScaleChange(Number(e.currentTarget.value))}
				aria-label={t('PAGES.OPTIONS.APPLICATION.SCALE_LABEL')}
			>
				{#each ZOOM_SCALE as scale (scale)}
					<option value={scale}>{Math.round(scale * 100)}%</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="divider"></div>

	<!-- BEHAVIOUR -->
	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.MINIMIZE_ON_CLOSE_LABEL')}</div>
			<small class="text-2">{minimizeOnCloseDescription}</small>
		</div>
		<Toggle bind:checked={collapseToTray} onCheckedChange={onCollapseChange} />
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.START_WITH_SYSTEM_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.START_WITH_SYSTEM_DESCRIPTION')}</small>
		</div>
		<Toggle bind:checked={startWithSystem} onCheckedChange={onStartWithSystemChange} />
	</div>

	{#if startWithSystem}
		<div class="setting indented">
			<div class="grow">
				<div>{t('PAGES.OPTIONS.APPLICATION.START_MINIMIZED_LABEL')}</div>
				<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.START_MINIMIZED_DESCRIPTION')}</small>
			</div>
			<Toggle bind:checked={startMinimized} onCheckedChange={onStartMinimizedChange} />
		</div>
	{/if}

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.ENABLE_SYSTEM_NOTIFICATIONS_LABEL')}</div>
			<small class="text-2"
				>{t('PAGES.OPTIONS.APPLICATION.ENABLE_SYSTEM_NOTIFICATIONS_DESCRIPTION')}</small
			>
		</div>
		<Toggle
			bind:checked={enableSystemNotifications}
			onCheckedChange={onEnableSystemNotifications}
		/>
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.ENABLE_APP_BADGE_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.ENABLE_APP_BADGE_DESCRIPTION')}</small>
		</div>
		<Toggle bind:checked={enableAppBadge} onCheckedChange={(c) => void onToggleAppBadge(c)} />
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.KEEP_LAST_OPENED_TAB_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.KEEP_LAST_OPENED_TAB_DESCRIPTION')}</small
			>
		</div>
		<Toggle bind:checked={keepAddonDetailTab} onCheckedChange={onKeepAddonDetailTabChange} />
	</div>

	<div class="divider"></div>

	<!-- SYSTEM -->
	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.USE_HARDWARE_ACCELERATION_LABEL')}</div>
			<small class="text-2">
				{t('PAGES.OPTIONS.APPLICATION.USE_HARDWARE_ACCELERATION_DESCRIPTION')}
			</small>
		</div>
		<Toggle
			bind:checked={useHardwareAcceleration}
			onCheckedChange={(c) => void onUseHardwareAccelerationChange(c)}
		/>
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.USE_SYMLINK_SUPPORT')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.USE_SYMLINK_SUPPORT_DESCRIPTION')}</small>
		</div>
		<Toggle bind:checked={useSymlinkMode} onCheckedChange={(c) => void onSymlinkModeChange(c)} />
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.PROTOCOL_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.PROTOCOL_DESCRIPTION')}</small>
		</div>
		<Toggle
			bind:checked={wowupProtocolHandled}
			onCheckedChange={(c) => void onProtocolHandlerChange(APP_PROTOCOL_NAME, c)}
		/>
	</div>

	{#if AppConfig.curseforge.enabled}
		<div class="setting">
			<div class="grow">
				<div>{t('PAGES.OPTIONS.APPLICATION.CURSE_PROTOCOL_LABEL')}</div>
				<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.CURSE_PROTOCOL_DESCRIPTION')}</small>
			</div>
			<Toggle
				bind:checked={curseforgeProtocolHandled}
				onCheckedChange={(c) => void onProtocolHandlerChange(CURSE_PROTOCOL_NAME, c)}
			/>
		</div>
	{/if}

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_DESCRIPTION')}</small>
		</div>
		<label class="field">
			<select
				value={currentReleaseChannel}
				onchange={(e) => void onReleaseChannelChange(Number(e.currentTarget.value))}
				aria-label={t('PAGES.OPTIONS.APPLICATION.APP_RELEASE_CHANNEL_DROPDOWN_LABEL')}
			>
				{#each RELEASE_CHANNELS as channel (channel.value)}
					<option value={channel.value}>{t(channel.labelKey)}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.APPLICATION.TELEMETRY_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.APPLICATION.TELEMETRY_DESCRIPTION')}</small>
		</div>
		<Toggle bind:checked={telemetryEnabled} onCheckedChange={onTelemetryChange} />
	</div>
</div>

<style>
	.container {
		padding: 1rem;
		overflow-y: auto;
		height: 100%;
	}

	h2 {
		margin-top: 0;
	}

	.setting {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.setting.indented {
		padding-left: 1.5rem;
	}

	.grow {
		flex: 1;
	}

	.field {
		min-width: 180px;
	}

	select {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.divider {
		margin: 1.25rem 0;
		border-top: 1px solid var(--overlay-selected);
	}
</style>
