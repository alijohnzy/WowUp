// Bridge between ag-grid's vanilla cell-renderer API and Svelte 5 components.
//
// Replaces `ag-grid-angular`, which the migration drops: ag-grid-community itself is
// framework-agnostic and stays (the gate decision was to keep the grid rather than
// re-implement sorting, column state and context menus).
//
// ag-grid asks for a class implementing ICellRendererComp — init/getGui/refresh/destroy.
// Svelte 5's `mount`/`unmount` map onto that directly, and `refresh` updates the component's
// props in place rather than tearing the cell down, which is what keeps scrolling smooth.

import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';

export interface CellProps<TData = unknown> {
	params: ICellRendererParams<TData>;
}

/**
 * ag-grid declares init/refresh/destroy as optional on ICellRendererComp, which makes the
 * returned class awkward to call directly (in tests, or when composing renderers). This
 * narrows them to required.
 */
export interface SvelteCellRendererComp<TData = unknown> extends ICellRendererComp<TData> {
	init(params: ICellRendererParams<TData>): void;
	getGui(): HTMLElement;
	refresh(params: ICellRendererParams<TData>): boolean;
	destroy(): void;
}

/**
 * Anything the column definition passed as `cellRendererParams`.
 *
 * ag-grid merges that object into `params` rather than keeping it separate, so it is read back
 * off the colDef — that way exactly the caller's keys are forwarded as props, and none of
 * ag-grid's own (api, node, column, value, …) leak in and shadow a component's prop.
 */
function customParams<TData>(params: ICellRendererParams<TData>): Record<string, unknown> {
	return (params.colDef?.cellRendererParams ?? {}) as Record<string, unknown>;
}

/**
 * Wrap a Svelte component so ag-grid can use it as a cell renderer.
 *
 *   { field: 'name', cellRenderer: svelteCellRenderer(MyAddonCell) }
 *
 * The component receives a reactive `params` prop, plus every key from the column's
 * `cellRendererParams` as its own prop:
 *
 *   cellRendererParams: { onViewDetails }   ->   let { params, onViewDetails } = $props()
 *
 * Forwarding those was missing initially, so a cell declaring `onViewDetails` got `undefined`
 * and its click handler silently did nothing — My Addons could only open an addon by
 * double-clicking the row, which is the grid's own handler rather than the cell's.
 */
export function svelteCellRenderer<TData = unknown>(
	SvelteComponent: Component<CellProps<TData>>
): new () => SvelteCellRendererComp<TData> {
	return class SvelteCellRenderer implements SvelteCellRendererComp<TData> {
		#element!: HTMLElement;
		#component!: Record<string, unknown>;
		// The intersection is what lets cellRendererParams keys sit alongside `params` without a
		// cast at the mount call: it still satisfies CellProps<TData>.
		#props = $state<CellProps<TData> & Record<string, unknown>>({ params: undefined as never });

		init(params: ICellRendererParams<TData>): void {
			this.#element = document.createElement('div');
			this.#element.className = 'ag-svelte-cell';
			Object.assign(this.#props, customParams(params), { params });

			this.#component = mount(SvelteComponent, {
				target: this.#element,
				props: this.#props
			}) as Record<string, unknown>;
		}

		getGui(): HTMLElement {
			return this.#element;
		}

		/**
		 * Returning true tells ag-grid the cell handled the update itself, so it reuses this
		 * instance instead of destroying and recreating it.
		 */
		refresh(params: ICellRendererParams<TData>): boolean {
			Object.assign(this.#props, customParams(params), { params });
			return true;
		}

		destroy(): void {
			if (this.#component) void unmount(this.#component);
		}
	};
}
