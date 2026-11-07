<script lang="ts">
	// One dot per client in that client's color (see utils/client-color.ts). Decorative: whatever
	// shows the dots also names the clients, in text or a tooltip.

	import type { WowInstallation } from 'wowup-lib-core';
	import { clientColor } from '$lib/utils/client-color';

	interface Props {
		installations: Pick<WowInstallation, 'id' | 'clientType' | 'color'>[];
	}

	let { installations }: Props = $props();
</script>

<span class="client-dots" aria-hidden="true">
	{#each installations as installation (installation.id)}
		{@const color = clientColor(installation)}
		{#if color}
			<span class="client-dot" style:background-color={color}></span>
		{/if}
	{/each}
</span>

<style>
	.client-dots {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 3px;
		vertical-align: middle;
	}

	.client-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
</style>
