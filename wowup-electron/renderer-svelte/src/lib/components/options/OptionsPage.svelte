<script lang="ts">
	// Port of src/app/pages/options/options.component.{ts,html} (222 LOC).
	//
	// The original faked vertical tabs with two Material widgets: a <mat-action-list> of
	// buttons driving `optionTabIndex`, plus a <mat-tab-group class="no-tabs"> whose headers
	// were hidden with CSS. bits-ui Tabs with orientation="vertical" is the same thing
	// natively, and brings roving focus + aria wiring the original did not have.
	//
	// Lives in $lib rather than a route so both /options and the Options tab of the home
	// shell render the same component.

	import { Tabs } from 'bits-ui';
	import { t } from '$lib/i18n.svelte';
	import { isElectron, invoke, isLinux, isMac, isWin } from '$lib/ipc';
	import About from '$lib/components/options/About.svelte';
	import AddonSection from '$lib/components/options/AddonSection.svelte';
	import AppSection from '$lib/components/options/AppSection.svelte';
	import CurseforgeSection from '$lib/components/options/CurseforgeSection.svelte';
	import DebugSection from '$lib/components/options/DebugSection.svelte';
	import WowSection from '$lib/components/options/WowSection.svelte';
	import WtfExplorer from '$lib/components/options/WtfExplorer.svelte';

	const IPC_OW_IS_CMP_REQUIRED = 'ow-is-cmp-required';

	let activeTab = $state('clients');
	let isCmpRequired = $state(false);

	$effect(() => {
		if (!isElectron()) return;
		invoke<boolean>(IPC_OW_IS_CMP_REQUIRED)
			.then((v) => (isCmpRequired = v))
			.catch(() => {
				// Channel only exists in the Overwolf flavour; absence is not an error.
			});
	});
</script>

<div class="tab-container" class:mac={isMac()} class:windows={isWin()} class:linux={isLinux()}>
	<Tabs.Root bind:value={activeTab} orientation="vertical" class="tabs-root">
		<Tabs.List class="nav-item-list">
			<Tabs.Trigger value="clients" class="nav-item">{t('PAGES.OPTIONS.TABS.CLIENTS')}</Tabs.Trigger
			>
			<Tabs.Trigger value="application" class="nav-item">
				{t('PAGES.OPTIONS.TABS.APPLICATION')}
			</Tabs.Trigger>
			<Tabs.Trigger value="addons" class="nav-item">{t('PAGES.OPTIONS.TABS.ADDONS')}</Tabs.Trigger>
			<Tabs.Trigger value="debug" class="nav-item">{t('PAGES.OPTIONS.TABS.DEBUG')}</Tabs.Trigger>
			<Tabs.Trigger value="wtf" class="nav-item">
				{t('PAGES.OPTIONS.TABS.WTF_EXPLORER')}
			</Tabs.Trigger>
			<Tabs.Trigger value="about" class="nav-item">{t('PAGES.OPTIONS.TABS.ABOUT')}</Tabs.Trigger>
			{#if isCmpRequired}
				<Tabs.Trigger value="curseforge" class="nav-item">
					{t('PAGES.OPTIONS.TABS.CURSEFORGE')}
				</Tabs.Trigger>
			{/if}
		</Tabs.List>

		<!--
			Each panel body is gated on the active tab. bits-ui's Tabs.Content always renders
			its children (it hides inactive panels rather than unmounting them), whereas
			Angular's <mat-tab> lazily created its content. Without this gate every section
			would mount at startup — and WTF Explorer would walk the WTF directory tree on
			app launch instead of when its tab is opened.
		-->
		<div class="nav-content bg-secondary-2 text-1">
			<Tabs.Content value="clients">
				{#if activeTab === 'clients'}<WowSection />{/if}
			</Tabs.Content>
			<Tabs.Content value="application">
				{#if activeTab === 'application'}<AppSection />{/if}
			</Tabs.Content>
			<Tabs.Content value="addons">
				{#if activeTab === 'addons'}<AddonSection />{/if}
			</Tabs.Content>
			<Tabs.Content value="debug">
				{#if activeTab === 'debug'}<DebugSection />{/if}
			</Tabs.Content>
			<Tabs.Content value="wtf">
				{#if activeTab === 'wtf'}<WtfExplorer />{/if}
			</Tabs.Content>
			<Tabs.Content value="about">
				{#if activeTab === 'about'}<About />{/if}
			</Tabs.Content>
			{#if isCmpRequired}
				<Tabs.Content value="curseforge">
					{#if activeTab === 'curseforge'}<CurseforgeSection />{/if}
				</Tabs.Content>
			{/if}
		</div>
	</Tabs.Root>
</div>

<style>
	.tab-container {
		height: 100%;
		display: flex;
		min-height: 0;
	}

	/* bits-ui puts our class straight onto its rendered element */
	:global(.tabs-root) {
		display: flex;
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	:global(.nav-item-list) {
		display: flex;
		flex-direction: column;
		min-width: 180px;
		padding: 0.5rem;
		gap: 2px;
	}

	:global(.nav-item) {
		appearance: none;
		background: none;
		border: 0;
		border-radius: 4px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		padding: 0.6rem 0.9rem;
		text-align: left;
		width: 100%;
	}

	:global(.nav-item:hover) {
		background: var(--overlay-hover);
	}

	:global(.nav-item[data-state='active']) {
		background: var(--overlay-selected);
		font-weight: 600;
	}

	:global(.nav-item:focus-visible) {
		outline: 2px solid var(--control-color);
		outline-offset: -2px;
	}

	.nav-content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
</style>
