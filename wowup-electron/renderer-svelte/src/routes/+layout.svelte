<script lang="ts">
	// Replaces the bootstrap half of src/app/app.component.ts (635 LOC) and app.module.ts.
	//
	// Angular spread startup across an AppComponent constructor, ngOnInit, and several
	// service constructors that fired async chains at DI time. Here the order is explicit
	// and awaited in one place.

	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import {
		APP_PROTOCOL_NAME,
		IPC_MENU_ZOOM_IN_CHANNEL,
		IPC_MENU_ZOOM_OUT_CHANNEL,
		IPC_MENU_ZOOM_RESET_CHANNEL
	} from '$common/constants';
	import { getProtocol, getProtocolParts } from '$lib/utils/string';
	import AnimatedLogo from '$lib/components/common/AnimatedLogo.svelte';
	import InstallFromProtocolDialog from '$lib/components/addons/InstallFromProtocolDialog.svelte';
	import DialogHost from '$lib/components/common/DialogHost.svelte';
	import Footer from '$lib/components/common/Footer.svelte';
	import Snackbar from '$lib/components/common/Snackbar.svelte';
	import Titlebar from '$lib/components/common/Titlebar.svelte';
	import VerticalTabs from '$lib/components/common/VerticalTabs.svelte';
	import { isElectron, on, platform } from '$lib/ipc';
	import { addonService, onAddonInstalled, ScanUpdateType } from '$lib/state/addon.svelte';
	import { AddonInstallState } from '$lib/models/addon-install-state';
	import { AppUpdateState } from '$common/wowup/models';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import * as analytics from '$lib/services/analytics';
	import { startAutoUpdate, updateBadgeCount } from '$lib/services/auto-update';
	import { createAppMenu, createSystemTray } from '$lib/services/native-menu';
	import { changeLogs } from '$lib/data/changelogs';
	import { AppConfig } from '$config/environment';
	import {
		GitHubFetchReleasesError,
		GitHubFetchRepositoryError,
		GitHubLimitError
	} from '$lib/errors';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { t, i18n } from '$lib/i18n.svelte';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { electron } from '$lib/state/electron.svelte';
	import { session } from '$lib/state/session.svelte';
	import { theme } from '$lib/state/theme.svelte';
	import { startPushService } from '$lib/state/push.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import { wowup } from '$lib/state/wowup.svelte';
	import { wowUpAccount } from '$lib/state/wowup-account.svelte';
	import { wowUpAddon } from '$lib/services/wowup-addon';
	import { zoom, ZoomDirection } from '$lib/state/zoom.svelte';

	let { children } = $props();

	let ready = $state(false);
	let bootError = $state<string | undefined>(undefined);
	// Replaces home.component.ts's preloadSpinnerKey — the message shown over the splash while
	// a long startup step runs.
	let preloadMessage = $state('');

	// Replaces WowUpProtocolService (48 LOC). It was an injectable whose whole job was to
	// filter one event stream and open one dialog; the dialog has to render somewhere, and
	// this is that somewhere, so the indirection buys nothing.
	let installProtocol = $state<string | undefined>(undefined);

	$effect(() =>
		electron.customProtocol.subscribe((protocol) => {
			if (getProtocol(protocol) !== APP_PROTOCOL_NAME) return;
			if (getProtocolParts(protocol)[0] !== 'install') return;
			installProtocol = protocol;
		})
	);

	// Shell-level notifications. app.component.ts and home.component.ts subscribed to these three
	// streams and turned them into snackbars and status text; the port had the emitters but
	// nothing consuming them, so addon scan/sync/install failures were silent and the scan
	// progress line never appeared.

	$effect(() =>
		addonService.scanError.subscribe((error) =>
			snackbar.showError('COMMON.ERRORS.ADDON_SCAN_ERROR', {
				timeout: 4000,
				localeArgs: { providerName: error.providerName }
			})
		)
	);

	$effect(() =>
		addonService.syncError.subscribe((error) => {
			const inner = error.innerError;

			// A GitHub rate-limit or fetch failure is actionable in a way the generic message is
			// not, so it gets its own text — as in app.component.ts.
			if (inner instanceof GitHubLimitError) {
				snackbar.showError('COMMON.ERRORS.GITHUB_LIMIT_ERROR', {
					localeArgs: {
						max: inner.rateLimitMax,
						reset: new Date(inner.rateLimitReset * 1000).toLocaleString()
					}
				});
				return;
			}

			if (
				inner instanceof GitHubFetchReleasesError ||
				inner instanceof GitHubFetchRepositoryError
			) {
				snackbar.showError('COMMON.ERRORS.GITHUB_REPOSITORY_FETCH_ERROR', {
					localeArgs: { addonName: error.addonName ?? '' }
				});
				return;
			}

			snackbar.showError(
				error.addonName ? 'COMMON.ERRORS.ADDON_SYNC_FULL_ERROR' : 'COMMON.ERRORS.ADDON_SYNC_ERROR',
				{
					localeArgs: {
						providerName: error.providerName,
						addonName: error.addonName ?? '',
						installationName: error.installationName ?? ''
					}
				}
			);
		})
	);

	$effect(() =>
		onAddonInstalled((evt) => {
			if (evt.installState === AddonInstallState.Error) {
				snackbar.showError('COMMON.ERRORS.ADDON_INSTALL_ERROR', {
					localeArgs: { addonName: evt.addon.name }
				});
				return;
			}

			// The taskbar/dock badge counts pending updates, so installing one has to redo the sum.
			if (evt.installState === AddonInstallState.Complete) {
				void updateBadgeCount();
			}
		})
	);

	// Removing an addon changes the pending-update count too, and so does a sync or scan — those
	// are what discover that an update exists in the first place.
	$effect(() => addonService.addonRemoved.subscribe(() => void updateBadgeCount()));
	$effect(() =>
		addonService.addonAction.subscribe((action) => {
			if (action.type === 'sync' || action.type === 'scan') void updateBadgeCount();
		})
	);

	// View → Zoom In/Out/Reset. The main process only sends these; the renderer owns the zoom
	// factor. Nothing listened, so the menu entries this port now creates were inert.
	$effect(() => {
		const offs = [
			on(IPC_MENU_ZOOM_IN_CHANNEL, () => void zoom.applyZoom(ZoomDirection.ZoomIn)),
			on(IPC_MENU_ZOOM_OUT_CHANNEL, () => void zoom.applyZoom(ZoomDirection.ZoomOut)),
			on(IPC_MENU_ZOOM_RESET_CHANNEL, () => void zoom.applyZoom(ZoomDirection.ZoomReset))
		];
		return () => offs.forEach((off) => off());
	});

	// The original also refreshed the badge when the machine woke up — on macOS the badge is
	// dropped across sleep, and the 1s delay is there because setting it immediately does not
	// always take.
	$effect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = electron.windowResumed.subscribe(() => {
			clearTimeout(timer);
			timer = setTimeout(() => void updateBadgeCount(), 1000);
		});
		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	});

	// App self-update. app.component.ts surfaced two of the updater's states: an error snackbar,
	// and a non-dismissable prompt once a build has downloaded. Both emitters existed in the port
	// but nothing listened, so a downloaded update never told the user.
	$effect(() => {
		const evt = electron.appUpdate;
		if (!evt) return;

		if (evt.state === AppUpdateState.Error) {
			// A missing dev-app-update.yml just means "not packaged"; not worth showing.
			if (!evt.error?.includes('dev-app-update.yml')) {
				snackbar.showError('APP.WOWUP_UPDATE.UPDATE_ERROR');
			}
			return;
		}

		if (evt.state === AppUpdateState.Downloaded) {
			void dialogs
				.alert(
					{
						title: t('APP.WOWUP_UPDATE.INSTALL_TITLE'),
						message: t('APP.WOWUP_UPDATE.SNACKBAR_TEXT'),
						positiveButton: 'APP.WOWUP_UPDATE.DOWNLOADED_TOOLTIP'
					},
					// disableClose: the original forces the update once it is ready.
					true
				)
				.then(() => wowup.installUpdate());
		}
	});

	// The theme's custom properties are declared on the theme class, which sits on .app-root.
	// bits-ui portals its popups into <body> — a sibling of .app-root — so every var(--…) in a
	// portalled Select panel resolved to nothing and the dropdown rendered unstyled. Mirroring
	// the class onto <body> puts the variables above the portal target as well as the app tree,
	// and does so for any future portalled popup rather than just the one that surfaced it.
	// The theme classes declare only custom properties and color-scheme, so this adds no layout.
	$effect(() => {
		const themeClass = theme.current;
		document.body.classList.add(themeClass);
		return () => document.body.classList.remove(themeClass);
	});

	// The key art starts at 10% — dim enough that the WowUp logo reads over it on the splash —
	// and rises to 50% once the app itself is on screen. 50% is the value the app wears; at 10%
	// under the chrome's rgba surfaces it is all but invisible.
	//
	// app.component.ts does this on a bare `setTimeout(…, 1000)` from its constructor, which
	// works there because Angular's renderer is not up until well after that — the change lands
	// while the splash still covers it. This port reaches first paint in roughly 640ms, so the
	// same fixed delay stepped the brightness up a beat *after* the UI appeared, which read as a
	// flash. Keying it to `ready` expresses what the 1s was standing in for, and the 400ms CSS
	// transition on the element makes it a fade rather than a jump.
	$effect(() => {
		if (!ready) return;
		const art = document.getElementById('wow-background');
		if (art) art.style.opacity = '0.5';
	});

	// Scan progress in the footer status line.
	$effect(() => {
		const update = addonService.scanUpdate;
		switch (update.type) {
			case ScanUpdateType.Start:
				session.statusText = t('APP.STATUS_TEXT.ADDON_SCAN_STARTED');
				break;
			case ScanUpdateType.Update:
				session.statusText = t('APP.STATUS_TEXT.ADDON_SCAN_UPDATE', { count: update.totalCount });
				break;
			case ScanUpdateType.Complete: {
				session.statusText = t('APP.STATUS_TEXT.ADDON_SCAN_COMPLETED');
				const timer = setTimeout(() => (session.statusText = ''), 3000);
				return () => clearTimeout(timer);
			}
		}
	});

	/**
	 * First-run permissions. app.component.ts gated this on either the telemetry prompt or the
	 * provider consent being outstanding, and used disableClose so it cannot be dismissed.
	 * DialogHost has always been able to render it — nothing ever opened it.
	 */
	async function showConsentDialog(): Promise<void> {
		const needed =
			(await analytics.shouldPromptTelemetry()) || (await addonProviders.shouldShowConsentDialog());
		if (!needed) return;

		const result = await dialogs.consent({
			title: t('DIALOGS.PERMISSIONS.TITLE'),
			requiresCmp: AppConfig.curseforge.enabled
		});
		if (!result) return;

		if (AppConfig.wago.enabled) {
			await addonProviders.setProviderEnabled('Wago', result.wagoProvider);
			await addonProviders.updateWagoConsent();
		}
		await analytics.setTelemetryEnabled(result.telemetry);
	}

	/** "What's new" on first launch of a new build. Also never wired up. */
	async function showNewVersionNotes(): Promise<void> {
		if (!(await wowup.shouldShowNewVersionNotes())) return;

		const version = electron.appVersion;
		const entry = changeLogs.find((log) => log.Version === version);
		if (entry) {
			await dialogs.patchNotes({
				title: i18n.t('DIALOGS.NEW_VERSION_POPUP.TITLE', { versionNumber: version }),
				html: entry.html ?? entry.Description ?? ''
			});
		}
		await wowup.setNewVersionNotes();
	}

	/**
	 * A deep re-scan run once per app version, before the UI is usable — it rewrites addon
	 * records, so the preload spinner stays up with its own message while it runs.
	 */
	async function migrateAddons(): Promise<void> {
		const installations = warcraftInstallations.installations;
		if (installations.length === 0) return;
		if (!(await wowup.shouldMigrateAddons())) return;

		preloadMessage = t('PAGES.HOME.MIGRATING_ADDONS');
		try {
			for (const installation of installations) {
				await addonService.migrateDeep(installation);
			}
			await wowup.setMigrationVersion();
		} catch (e) {
			console.error('Failed to migrate addons', e);
		} finally {
			preloadMessage = '';
		}
	}

	async function bootstrap(): Promise<void> {
		// Language first: an unsupported saved locale must not break the rest of startup.
		if (isElectron()) {
			await wowup.initializeLanguage();
		} else {
			await i18n.load('en');
		}

		electron.start();
		zoom.start();
		startPushService();
		wowUpAccount.start();

		// Order matters below: providers read preferences, installations read providers,
		// and session derives its initial tab from the installation list.
		await wowup.init().catch((e: unknown) => console.error('wowup init failed', e));
		// Before first paint: the theme class decides every colour on the shell.
		await theme.init().catch((e: unknown) => console.error('theme init failed', e));
		await addonProviders
			.loadProviders()
			.catch((e: unknown) => console.error('provider load failed', e));
		await warcraftInstallations
			.init()
			.catch((e: unknown) => console.error('warcraft installations init failed', e));
		await addonService.init().catch((e: unknown) => console.error('addon init failed', e));
		await session.init().catch((e: unknown) => console.error('session init failed', e));

		wowUpAddon.start();

		// The native menu bar and tray menu are built in the main process but translated here,
		// so they cannot be created until the locale has loaded. Angular did this in
		// ngAfterViewInit; nothing in the port created either, leaving the app with Electron's
		// default menu and no tray icon.
		await createAppMenu();
		await createSystemTray();

		// Consent gates telemetry and the Wago provider, so it runs before anything reports or
		// searches. Migration rewrites addon records, so it runs before the grid can read them.
		await showConsentDialog().catch((e: unknown) => console.error('consent failed', e));
		await migrateAddons();

		// Not awaited — pruning orphaned addons must not hold up first paint.
		void addonService.reconcileOrphanAddonsForCurrentInstallations();
	}

	$effect(() => {
		bootstrap()
			.then(() => {
				ready = true;
				// After first paint — none of this should hold the splash. The auto-update job
				// syncs every client and can run for a while; it was missing entirely, so addons
				// with auto-update on were never actually updated in the background, and the
				// `--quit` scheduled-task mode never terminated.
				void startAutoUpdate();
				return showNewVersionNotes();
			})
			.catch((e: unknown) => {
				console.error('bootstrap failed', e);
				bootError = e instanceof Error ? e.message : String(e);
				ready = true; // render anyway; degrade rather than showing nothing
			});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>WowUp</title>
</svelte:head>

<!--
  Port of src/app/app.component.html — the app shell.
  Structure matches the original: titlebar across the top, the vertical tab rail on the
  left, routed content in the middle, footer along the bottom. AnimatedLogo covers the
  pre-load state that Angular expressed as `*ngIf="(showPreLoad$ | async) === true"`.
-->
<div class="app-root {theme.current} {platform()}">
	{#if ready}
		<Titlebar />

		{#if bootError}
			<p class="boot-error">Startup problem: {bootError}</p>
		{/if}

		<div class="app-body">
			<VerticalTabs />
			<div class="content bg-secondary-3">
				{@render children()}
			</div>
		</div>

		<Footer />
	{:else}
		<AnimatedLogo />
		{#if preloadMessage}<p class="preload-message text-2">{preloadMessage}</p>{/if}
	{/if}

	<DialogHost />

	{#if installProtocol}
		<InstallFromProtocolDialog
			protocol={installProtocol}
			onclose={() => (installProtocol = undefined)}
		/>
	{/if}
	<Snackbar />
</div>

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}

	.app-root {
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: var(--text-1);
		/* Deliberately no background. app.component.scss's .app has none either, and that is what
		   lets #wow-background show through the whole window — the art is behind the app, and the
		   app's own surfaces are rgba so it reads through them. Painting
		   var(--background-secondary-2) here (90% opaque) over art at 10% opacity left roughly 1%
		   of it visible, which is indistinguishable from absent. The base colour comes from
		   <body>, set from window.baseBgColor in app.html. */
	}

	.app-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.boot-error {
		margin: 0;
		padding: 0.5rem 1rem;
		background: #f44336;
		color: #fff;
	}
</style>
