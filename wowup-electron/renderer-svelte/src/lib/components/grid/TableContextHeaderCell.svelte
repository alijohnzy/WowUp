<script lang="ts">
	// Port of components/addons/table-context-header-cell (93 LOC).
	//
	// A custom ag-grid header that adds a right-click context menu on top of the normal
	// sort-cycle behaviour. Removed: NgZone and the BehaviorSubject holding the sort state.

	import type { Column, IHeaderParams } from 'ag-grid-community';
	import Icon from '$lib/components/common/Icon.svelte';

	export interface ContextHeaderParams extends IHeaderParams {
		onHeaderContext: (event: MouseEvent) => void;
	}

	interface Props {
		params: ContextHeaderParams;
	}

	let { params }: Props = $props();

	let sorted = $state<'asc' | 'desc' | ''>('');

	function readSort(column: Column) {
		if (column.isSortAscending()) sorted = 'asc';
		else if (column.isSortDescending()) sorted = 'desc';
		else sorted = '';
	}

	$effect(() => {
		const column = params.column;
		const onSortChanged = () => readSort(column);

		column.addEventListener('sortChanged', onSortChanged);
		readSort(column);

		return () => column.removeEventListener('sortChanged', onSortChanged);
	});

	// asc -> desc -> unsorted
	const nextSort = (current: string): 'asc' | 'desc' | null =>
		current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';

	function onSortRequested(event: MouseEvent) {
		if (params.enableSorting !== true) return;
		// Shift-click appends to the existing multi-sort rather than replacing it.
		params.setSort(nextSort(sorted), event.shiftKey);
	}

	function onContextMenu(event: MouseEvent) {
		event.preventDefault();
		params.onHeaderContext(event);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ag-cell-label-container" onclick={onSortRequested} oncontextmenu={onContextMenu}>
	<div class="ag-header-cell-label">
		<span class="ag-header-cell-text">{params.displayName}</span>
		{#if sorted === 'asc'}
			<span class="ag-header-icon ag-header-label-icon"><Icon name="fas:arrow-up" /></span>
		{:else if sorted === 'desc'}
			<span class="ag-header-icon ag-header-label-icon"><Icon name="fas:arrow-down" /></span>
		{/if}
	</div>
</div>

<style>
	.ag-cell-label-container {
		display: flex;
		align-items: center;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}

	.ag-header-cell-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
</style>
