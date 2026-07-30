<script lang="ts">
	// Port of components/addons/funding-button (160 LOC).
	//
	// The Angular version had five parallel switch statements over `funding.platform`
	// (isFontIcon / fontIcon / imageIcon / className / displayName), computed in ngOnInit
	// into five fields. One table keyed by platform replaces all of them — and makes it
	// obvious that `getIsFontIcon` returned true on every branch, so the image-icon path
	// and its four asset lookups were unreachable.

	import { i18n } from '$lib/i18n.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import { externalLink } from '$lib/attachments/external-link';
	import type { AddonFundingLink } from 'wowup-lib-core';

	interface Props {
		funding: AddonFundingLink;
		size?: 'large' | 'small';
	}

	let { funding, size = 'large' }: Props = $props();

	const PLATFORMS: Record<string, { icon: IconName; name: string; className: string }> = {
		PATREON: { icon: 'fab:patreon', name: 'Patreon', className: 'patreon-icon' },
		GITHUB: { icon: 'fab:github', name: 'GitHub', className: 'github-icon' },
		LIBERAPAY: { icon: 'fas:coins', name: 'Liberapay', className: 'custom-icon' },
		PAYPAL: { icon: 'fas:coins', name: 'PayPal', className: 'custom-icon' },
		KO_FI: { icon: 'fas:coins', name: 'Ko-fi', className: 'custom-icon' }
	};

	const FALLBACK = { icon: 'fas:coins' as IconName, name: 'Custom', className: 'custom-icon' };

	let platform = $derived(PLATFORMS[funding.platform] ?? FALLBACK);

	let tooltip = $derived(
		i18n.t(
			platform.name.toUpperCase() !== 'CUSTOM'
				? 'PAGES.MY_ADDONS.FUNDING_TOOLTIP.GENERIC'
				: 'PAGES.MY_ADDONS.FUNDING_TOOLTIP.CUSTOM',
			{ platform: platform.name }
		)
	);
</script>

<a
	class="funding-button {size} {platform.className}"
	class:wu-btn={size === 'large'}
	class:wu-btn-primary={size === 'large'}
	href={funding.url}
	title={tooltip}
	{@attach externalLink()}
>
	<Icon name={platform.icon} />
	{#if size === 'large'}
		<span>{platform.name}</span>
	{/if}
</a>

<style>
	.funding-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		text-decoration: none;
		color: inherit;
	}

	.funding-button.small {
		padding: 0.2rem;
	}

	.funding-button.small:hover {
		opacity: 0.8;
	}

	.patreon-icon {
		color: #f96854;
	}
</style>
