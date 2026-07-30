<script lang="ts">
	// Port of components/common/vertical-tabs (535 LOC) — the app's primary navigation.
	//
	// Each Tab in the Angular version carried two Observables (`isSelected$`, `isDisabled$`)
	// built from `combineLatest` + `map` per tab. Here they are two functions over $state,
	// which is why the tab table below is data rather than five near-identical objects.
	//
	// Note: `newsTab` and `aboutTab` were defined in the Angular component but left out of
	// tabsTop/tabsBottom, so News never appears in the rail. That is preserved — /news has a
	// route but no entry here.
	//
	// The tabs were <button>s that assigned session.selectedHomeTab. They are links now, which
	// is not cosmetic: middle-click, the back button and a deep link into a screen all work
	// because the browser handles them, not because this component reimplemented them.

	import { FEATURE_ACCOUNTS_ENABLED } from '$common/constants';
	import { page } from '$app/state';
	import { currentPath, href, ROUTES, type RoutePath } from '$lib/routes';
	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import { isLinux, isMac, isWin } from '$lib/ipc';
	import { externalLink } from '$lib/attachments/external-link';
	import Icon from './Icon.svelte';
	import AdWebView from './AdWebView.svelte';
	import type { IconName } from '$lib/icons';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import { wowUpAccount } from '$lib/state/wowup-account.svelte';

	interface Tab {
		path: RoutePath;
		titleKey: string;
		icon: IconName;
		/** Addon tabs additionally require a WoW installation. */
		needsInstall?: boolean;
	}

	const TABS_TOP: Tab[] = [
		{
			path: ROUTES.myAddons,
			titleKey: 'PAGES.HOME.MY_ADDONS_TAB_TITLE',
			icon: 'fas:dice-d6',
			needsInstall: true
		},
		{
			path: ROUTES.getAddons,
			titleKey: 'PAGES.HOME.GET_ADDONS_TAB_TITLE',
			icon: 'fas:magnifying-glass',
			needsInstall: true
		}
	];

	const TABS_BOTTOM: Tab[] = [
		{ path: ROUTES.options, titleKey: 'PAGES.HOME.OPTIONS_TAB_TITLE', icon: 'fas:gear' }
	];

	let collapsedPref = $state(false);

	// The ad frame needs the full width, so it forces the rail expanded.
	let isCollapsed = $derived(session.adSpace ? false : collapsedPref);

	// Was a BehaviorSubject fed from an adSpace$ subscription in the constructor.
	let adPageParams = $derived(
		session.adSpace
			? addonProviders
					.getAdRequiredProviders()
					.map((provider) => provider.getAdPageParams())
					.filter((params) => params !== undefined)
			: []
	);

	const isSelected = (path: RoutePath) => currentPath(page.route?.id) === path;

	const isDisabled = (tab: Tab) =>
		!session.enableControls ||
		(tab.needsInstall === true && warcraftInstallations.installations.length === 0);

	async function onClickAdExplainer() {
		await dialogs.alert({
			title: t('ADS.AD_EXPLAINER_DIALOG.TITLE'),
			message: t('ADS.AD_EXPLAINER_DIALOG.MESSAGE')
		});
	}
</script>

<div
	class="tab-strip bg-secondary-2 text-1"
	class:mac={isMac()}
	class:windows={isWin()}
	class:linux={isLinux()}
	class:wago={AppConfig.wago.enabled}
	class:curseforge={AppConfig.curseforge.enabled}
	class:collapsed={isCollapsed}
	class:has-ad={session.adSpace}
>
	<!-- The coloured wash behind the logo. The logo asset itself is monochrome white — the tint
	     comes entirely from this radial gradient of --background-primary, so it changes with the
	     theme. Missing it leaves the corner flat grey. -->
	<div class="theme-logo-glow"></div>

	<!-- `rail-logo`, not `theme-logo`: the rail uses --title-logo (always the white mark, which
	     the light themes invert to black), whereas the About/Account/News watermarks use
	     --theme-logo. vertical-tabs.component.scss draws the same distinction. -->
	<div class="rail-logo"><div class="logo-img"></div></div>

	{#each TABS_TOP as tab (tab.path)}
		{@render navTab(tab)}
	{/each}

	{#if FEATURE_ACCOUNTS_ENABLED}
		<a
			class="tab"
			class:selected={isSelected(ROUTES.account)}
			href={href(ROUTES.account)}
			title={t('PAGES.HOME.ACCOUNT_TAB_TITLE')}
		>
			<Icon name="fas:circle-user" size="1.25em" />
			<span class="tab-title">
				{t('PAGES.HOME.ACCOUNT_TAB_TITLE')}
				{#if wowUpAccount.authenticated}
					<small class="tab-subtitle">Logged in</small>
				{/if}
			</span>
		</a>
	{/if}

	{#each TABS_BOTTOM as tab (tab.path)}
		{@render navTab(tab)}
	{/each}

	<div class="spacer"></div>

	<a
		class="tab"
		href="{AppConfig.wowUpWebsiteUrl}/guide"
		title={t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.VIEW_GUIDE')}
		{@attach externalLink()}
	>
		<Icon name="far:circle-question" size="1.25em" />
		<span class="tab-title">{t('PAGES.HOME.GUIDE_TAB_TITLE')}</span>
	</a>

	<a
		class="tab"
		href="https://discord.gg/rk4F5aD"
		title={t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.JOIN_DISCORD')}
		{@attach externalLink()}
	>
		<Icon name="fab:discord" size="1.25em" />
		<span class="tab-title">{t('PAGES.HOME.DISCORD_TAB_TITLE')}</span>
	</a>

	<!-- Wordmark when the rail is expanded, the small mark when collapsed — as in
	     vertical-tabs.component.html. -->
	<a
		class="tab patreon-link"
		href="https://www.patreon.com/jliddev"
		title={t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.PATREON_SUPPORT')}
		{@attach externalLink()}
	>
		<img
			class="patron-img"
			src={isCollapsed
				? './assets/images/patreon_logo_small.png'
				: './assets/Digital-Patreon-Wordmark_FieryCoral.png'}
			alt={t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.PATREON_SUPPORT')}
		/>
	</a>

	{#if !session.adSpace}
		<button
			class="tab"
			onclick={() => (collapsedPref = !collapsedPref)}
			title={isCollapsed
				? t('PAGES.HOME.EXPAND_BUTTON_TITLE')
				: t('PAGES.HOME.COLLAPSE_BUTTON_TITLE')}
		>
			<Icon name={isCollapsed ? 'far:square-caret-right' : 'far:square-caret-left'} size="1.25em" />
			<span class="tab-title">{t('PAGES.HOME.COLLAPSE_BUTTON_TITLE')}</span>
		</button>
	{/if}

	{#if session.adSpace}
		<div class="ad-space">
			<button class="tab addon-info-btn" onclick={onClickAdExplainer}>
				{t('ADS.AD_EXPLAINER_BUTTON')}
			</button>
			<div class="ad">
				{#each adPageParams as params (params.pageUrl)}
					<AdWebView options={params} />
				{/each}
			</div>
		</div>
	{/if}
</div>

<!--
  A disabled tab keeps its href so it stays in the tab order and looks the same width — the
  click is cancelled instead. `aria-disabled` is what conveys the state; `disabled` is not a
  valid attribute on an anchor.
-->
{#snippet navTab(tab: Tab)}
	<a
		class="tab"
		class:selected={isSelected(tab.path)}
		class:disabled={isDisabled(tab)}
		href={href(tab.path)}
		aria-disabled={isDisabled(tab)}
		title={t(tab.titleKey)}
		onclick={(e) => {
			if (isDisabled(tab)) e.preventDefault();
		}}
	>
		<Icon name={tab.icon} size="1.25em" />
		<span class="tab-title">{t(tab.titleKey)}</span>
	</a>
{/snippet}

<style>
	.tab-strip {
		display: flex;
		flex-direction: column;
		flex: none;
		width: 200px;
		/* Reserves the space the fixed logo occupies, so the first tab is not underneath it.
		   vertical-tabs.component.scss: padding-top: calc(1em + 50px). */
		padding: calc(1em + 50px) 0 0.5rem;
		transition: width 120ms ease;
	}

	/* The ad is fixed-size and lives in the rail, so the rail has to be at least as wide or it
	   clips — 300x250 for wago, 400x300 for CurseForge. vertical-tabs.component.scss gets this
	   for free by giving .tab-strip no width at all and letting the ad size it; this port pins
	   200px for the no-ad case, so the ad widths have to be stated.
	   Driven by an explicit `has-ad` class rather than :has(.ad-space): Svelte scopes selectors
	   inside :has() too, which makes the rule depend on the scope class landing on the ad
	   element — needlessly indirect when session.adSpace already decides this. */
	.tab-strip.wago.has-ad {
		width: 300px;
	}

	.tab-strip.curseforge.has-ad {
		width: 400px;
	}

	.tab-strip.collapsed {
		width: 56px;
	}

	.tab-strip .tab-title {
		overflow: hidden;
	}

	/* 150px radial gradient bleeding in from off-canvas at the top-left corner. */
	/* Fixed to the viewport, not the rail — both this and .rail-logo sit at the window's top-left
	   corner and float over the titlebar, which is a grid row above the rail. An earlier version
	   of this port put them in flow "to avoid depending on the titlebar's height"; that is exactly
	   backwards — in flow they start below the titlebar and the whole corner treatment sits ~30px
	   too low. vertical-tabs.component.scss uses position: fixed for both. */
	.theme-logo-glow {
		position: fixed;
		z-index: 1;
		top: -60px;
		left: -60px;
		height: 150px;
		width: 150px;
		border-radius: 50%;
		background: radial-gradient(circle, var(--background-primary) 0%, rgb(0 0 0 / 0) 70%);
		pointer-events: none;
	}

	.tab-strip.collapsed .tab-title {
		display: none;
	}

	/* 72px square, as in vertical-tabs.component.scss. The Angular rule was `position: fixed`
	   so the logo floated over the titlebar; keeping it in flow gives the same result without
	   depending on the titlebar's height. */
	.rail-logo {
		position: fixed;
		z-index: 1;
		top: 1em;
		left: 0.5em;
		height: 72px;
		width: 72px;
		overflow: hidden;
	}

	/* The collapsed rail is 56px wide, so the logo shrinks to fit it. */
	.tab-strip.collapsed .rail-logo {
		height: 50px;
		width: 50px;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.7rem 1rem;
		/* The selected state is a 0.5em accent bar on the leading edge. Reserving the width as a
		   transparent border on every tab keeps the labels from shifting when selection moves. */
		border: 0;
		border-left: 0.5em solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.tab:hover:not(.disabled) {
		background: var(--overlay-hover);
	}

	/* vertical-tabs.component.scss: `border-left: 0.5em solid var(--background-primary)`. */
	.tab.selected {
		border-left-color: var(--background-primary);
		background: var(--overlay-selected);
		font-weight: 600;
	}

	.tab.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tab:focus-visible {
		outline: 2px solid var(--control-color);
		outline-offset: -2px;
	}

	.tab-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-subtitle {
		display: block;
		opacity: 0.7;
		font-weight: 400;
	}

	.spacer {
		flex: 1;
	}

	.patreon-link .patron-img {
		height: 25px;
		width: auto;
	}

	.ad-space {
		display: flex;
		flex-direction: column;
		flex: none;
		width: auto;
	}

	.addon-info-btn {
		display: block;
		width: 100%;
		text-align: center;
	}

	/* --ad-placeholder shows through until the ad <webview> paints, so the panel never
	   renders as an empty box. */
	.ad {
		flex-shrink: 0;
		background-color: var(--background-secondary-4);
		background-image: var(--ad-placeholder);
		background-position: top 32px center;
		background-repeat: no-repeat;
		background-size: 55%;
	}

	.tab-strip.wago .ad-space,
	.tab-strip.wago .ad {
		width: 300px;
	}

	.tab-strip.wago .ad {
		height: 250px;
	}

	.tab-strip.curseforge .ad-space,
	.tab-strip.curseforge .ad {
		width: 400px;
	}

	.tab-strip.curseforge .ad {
		height: 300px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tab-strip {
			transition: none;
		}
	}
</style>
