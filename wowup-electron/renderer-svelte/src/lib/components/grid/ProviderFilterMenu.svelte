<script lang="ts" generics="T">
	// The "Show Providers" part of a table header's right-click menu, under "Show Columns"
	// (state/provider-filter.svelte.ts). Goes inside a <ContextMenu>.

	import { t } from '$lib/i18n.svelte';
	import type { ProviderFilter } from '$lib/state/provider-filter.svelte';

	interface Props {
		filter: ProviderFilter;
		/** The rows before this filter, to list their providers and count them. */
		rows: T[];
		providerOf: (row: T) => string | undefined;
		/** How a provider name reads in the menu; the name itself by default. */
		label?: (name: string) => string;
	}

	let { filter, rows, providerOf, label = (name) => name }: Props = $props();

	let options = $derived(filter.options(rows, providerOf));
</script>

{#if options.length > 0}
	<div class="menu-divider"></div>
	<div class="menu-header">{t('PAGES.MY_ADDONS.PROVIDER_FILTER.TITLE')}</div>
	<div class="menu-divider"></div>
	{#each options as option (option.name)}
		<label class="menu-item provider-option">
			<input
				type="checkbox"
				checked={option.shown}
				onchange={(e) => void filter.set(option.name, e.currentTarget.checked)}
			/>
			<span class="provider-name">{label(option.name)}</span>
			<span class="provider-count">{option.count}</span>
		</label>
	{/each}
	{#if filter.active}
		<button class="menu-item" onclick={() => void filter.showAll()}>
			{t('PAGES.MY_ADDONS.PROVIDER_FILTER.SHOW_ALL')}
		</button>
	{/if}
{/if}

<style>
	.provider-name {
		flex: 1;
	}

	.provider-count {
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
</style>
