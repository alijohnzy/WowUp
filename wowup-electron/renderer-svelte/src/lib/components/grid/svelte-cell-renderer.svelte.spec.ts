// Proves the ag-grid <-> Svelte 5 bridge actually works.
//
// This is the load-bearing piece of the "keep ag-grid, rewrite the cell renderers" decision:
// if refresh() did not update props in place, ag-grid would tear down and rebuild every
// visible cell on each data change, which is exactly the scroll jank the grid exists to
// avoid. Asserting it here is cheaper than discovering it on a 5,000-row addon list.

import { describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import type { ICellRendererParams } from 'ag-grid-community';
import { svelteCellRenderer } from './svelte-cell-renderer.svelte';
import ProbeCell from './ProbeCell.test.svelte';

const params = (value: unknown) => ({ value }) as ICellRendererParams;

describe('svelteCellRenderer', () => {
	it('mounts the component and exposes its DOM through getGui()', () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(params('DBM'));
		const gui = instance.getGui();

		expect(gui).toBeInstanceOf(HTMLElement);
		expect(gui.textContent).toContain('DBM');

		instance.destroy();
	});

	it('refresh() updates in place and keeps the same DOM node', async () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(params('DBM'));
		const first = instance.getGui();

		const handled = instance.refresh(params('WeakAuras'));

		// Returning true is what tells ag-grid to reuse the instance.
		expect(handled).toBe(true);
		expect(instance.getGui()).toBe(first);

		// Svelte applies DOM updates in a microtask, so the new value lands after a tick
		// rather than synchronously inside refresh(). ag-grid does not read the cell back
		// synchronously, so this is fine — but it is worth pinning down.
		await tick();

		expect(first.textContent).toContain('WeakAuras');
		expect(first.textContent).not.toContain('DBM');

		instance.destroy();
	});

	it('destroy() unmounts the component', () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(params('Details'));
		const gui = instance.getGui();
		expect(gui.textContent).toContain('Details');

		instance.destroy();
		expect(gui.textContent?.trim()).toBe('');
	});

	it('supports many independent instances, as a grid would create', () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instances = ['a', 'b', 'c'].map((v) => {
			const i = new Renderer();
			i.init(params(v));
			return i;
		});

		expect(instances.map((i) => i.getGui().textContent?.trim())).toEqual(['a', 'b', 'c']);
		instances.forEach((i) => i.destroy());
	});
});

describe('cellRendererParams forwarding', () => {
	// ag-grid merges cellRendererParams into `params`, so a cell that declares them as its own
	// props gets `undefined` unless the bridge reads them back off the colDef and forwards them.
	// When that was missing, MyAddonsAddonCell's onViewDetails was undefined and clicking an
	// addon name did nothing — the row only opened on double-click, via the grid's own handler.
	const withRendererParams = (value: unknown, cellRendererParams: Record<string, unknown>) =>
		({ value, colDef: { cellRendererParams } }) as unknown as ICellRendererParams;

	it('forwards cellRendererParams to the component as props', () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(withRendererParams('DBM', { label: 'from-col-def' }));

		expect(instance.getGui().querySelector('.label')?.textContent).toBe('from-col-def');
		instance.destroy();
	});

	it('forwards callbacks so cell-level interactions reach the page', () => {
		const poked: unknown[] = [];
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(withRendererParams('DBM', { onPoke: (v: unknown) => poked.push(v) }));
		instance.getGui().querySelector('button')?.click();

		expect(poked).toEqual(['DBM']);
		instance.destroy();
	});

	it('keeps forwarding them across refresh()', async () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		instance.init(withRendererParams('DBM', { label: 'first' }));
		instance.refresh(withRendererParams('WeakAuras', { label: 'second' }));
		await tick();

		expect(instance.getGui().querySelector('.label')?.textContent).toBe('second');
		instance.destroy();
	});

	it('does not let ag-grid internals shadow component props', () => {
		const Renderer = svelteCellRenderer(ProbeCell);
		const instance = new Renderer();

		// `label` is not a cellRendererParams key here, so it must not be picked up even though
		// a same-named key exists on the ag-grid params object.
		instance.init({ value: 'DBM', label: 'leaked', colDef: {} } as unknown as ICellRendererParams);

		expect(instance.getGui().querySelector('.label')).toBeNull();
		instance.destroy();
	});
});
