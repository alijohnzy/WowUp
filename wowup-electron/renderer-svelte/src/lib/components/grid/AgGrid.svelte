<script lang="ts">
	// Thin Svelte wrapper over ag-grid-community's vanilla `createGrid` API.
	//
	// This is what `<ag-grid-angular>` was doing: create the grid on mount, push option
	// changes in, destroy on unmount. ag-grid-angular itself is dropped — the grid library
	// is framework-agnostic and stays, per the migration's gate decision.

	import { untrack } from 'svelte';
	import { createGrid, type GridApi, type GridOptions } from 'ag-grid-community';
	import 'ag-grid-community/styles/ag-grid.css';
	import 'ag-grid-community/styles/ag-theme-material.css';

	interface Props<TData = unknown> {
		options: GridOptions<TData>;
		/** Row data is passed separately so updates don't rebuild the whole option object. */
		rowData?: TData[];
		onGridReady?: (api: GridApi<TData>) => void;
		class?: string;
	}

	let { options, rowData, onGridReady, class: klass = '' }: Props = $props();

	let container: HTMLDivElement;
	let api = $state<GridApi | undefined>(undefined);

	// Create once. `options` and `rowData` are read through untrack() deliberately: reading them
	// reactively here made this effect re-run on every row change, so each keystroke in the
	// filter box destroyed the grid and built a new one — which is both slow and how callers
	// ended up holding a destroyed GridApi ("Grid API function ... cannot be called as the grid
	// has been destroyed"). Subsequent changes are pushed in through setGridOption below, which
	// is the whole reason ag-grid exposes it.
	$effect(() => {
		const gridApi = createGrid(
			container,
			untrack(() => ({ ...options, rowData: rowData ?? [] }))
		);
		api = gridApi;
		onGridReady?.(gridApi);

		return () => {
			gridApi.destroy();
			api = undefined;
		};
	});

	// Row data changes go through setGridOption so ag-grid can diff rather than rebuild.
	$effect(() => {
		const rows = rowData;
		if (api && rows) api.setGridOption('rowData', rows);
	});

	$effect(() => {
		const defs = options.columnDefs;
		if (api && defs) api.setGridOption('columnDefs', defs);
	});
</script>

<div bind:this={container} class="ag-theme-material {klass}"></div>

<style>
	div {
		width: 100%;
		height: 100%;
	}

	/* ag-grid lays out whatever a header component hands back as a flex item of
	   .ag-header-cell-comp-wrapper. The cell-renderer bridge hands back a plain div, so it
	   shrink-wrapped to its content: the sort click target was 61x24 inside a 150x56 header
	   cell, and the cursor only turned into a pointer over the words. Angular had no such
	   wrapper — `host: { class: "ag-cell-label-container" }` put the class on the component's
	   own element, so ag-grid's sizing applied to it directly. */
	:global(.ag-header-cell-comp-wrapper > .ag-svelte-cell) {
		flex: 1 1 auto;
		height: 100%;
	}

	/* Replaces CellWrapTextComponent, an ag-grid renderer component that existed only to
	   clamp a cell to three lines. Applied via `cellClass: 'cell-wrap-text'`, so the cell
	   stays plain text — no component instance, no bridge, no mount/destroy per row. */
	:global(.ag-cell.cell-wrap-text) {
		white-space: normal;
		line-height: 1.2em;
		word-break: break-all;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
