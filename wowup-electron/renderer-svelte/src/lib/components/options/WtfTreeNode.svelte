<script lang="ts">
	// Recursive tree node. Replaces @angular/cdk/tree's FlatTreeControl +
	// MatTreeFlattener + MatTreeFlatDataSource, which existed to flatten a nested structure
	// into a list because Material's tree renders a flat array. A component that renders
	// itself needs none of that machinery.

	import Icon from '$lib/components/common/Icon.svelte';
	import Self from './WtfTreeNode.svelte';

	export interface WtfTreeNodeModel {
		name: string;
		children?: WtfTreeNodeModel[];
		/** A .lua saved-variable file with no matching installed addon. */
		warn: boolean;
		ignore: boolean;
	}

	interface Props {
		node: WtfTreeNodeModel;
		level?: number;
	}

	let { node, level = 0 }: Props = $props();

	let expandable = $derived(Array.isArray(node.children) && node.children.length > 0);
	let expanded = $state(false);
</script>

<li style:--level={level}>
	<div class="node-row">
		{#if expandable}
			<button
				class="toggle"
				aria-expanded={expanded}
				aria-label="Toggle {node.name}"
				onclick={() => (expanded = !expanded)}
			>
				<Icon name={expanded ? 'fas:angle-down' : 'fas:chevron-right'} />
			</button>
		{:else}
			<span class="toggle-spacer"></span>
		{/if}

		<span class:text-warning={node.warn} class:text-muted={node.ignore}>{node.name}</span>
	</div>

	{#if expandable && expanded}
		<ul>
			{#each node.children ?? [] as child (child.name)}
				<Self node={child} level={level + 1} />
			{/each}
		</ul>
	{/if}
</li>

<style>
	li {
		list-style: none;
	}

	ul {
		margin: 0;
		padding: 0;
	}

	.node-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0;
		padding-left: calc(var(--level) * 1.25rem);
	}

	.toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		padding: 0;
	}

	.toggle:focus-visible {
		outline: 2px solid var(--control-color);
	}

	.toggle-spacer {
		width: 1.25rem;
	}

	.text-warning {
		color: #ffb74d;
	}

	.text-muted {
		opacity: 0.5;
	}
</style>
