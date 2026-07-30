<script lang="ts">
	// Port of components/options/wtf-explorer (524 LOC).
	//
	// Removed: 4 BehaviorSubjects, the @angular/cdk/tree flattener stack (see WtfTreeNode),
	// and the `@Input() set active()` getter/setter pair that existed to lazy-load when the
	// tab became visible — Svelte only mounts the panel when its tab is selected, so mount
	// *is* the lazy-load trigger.
	//
	// Roughly 250 lines of the original were commented-out mat-accordion markup and a
	// parallel `loadAccounts`/`getNode` implementation that nothing called. Not carried over.

	import { t } from '$lib/i18n.svelte';
	import { formatSize } from '$lib/utils/misc';
	import { removeExtension } from '$lib/utils/string';
	import { warcraft } from '$lib/state/warcraft.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import { wtf, type WtfNode } from '$lib/services/wtf';
	import WtfTreeNode, { type WtfTreeNodeModel } from './WtfTreeNode.svelte';
	import type { AddonFolder, WowInstallation } from 'wowup-lib-core';

	let installations = $derived(warcraftInstallations.installations);
	let selectedInstallationId = $state('');
	let loading = $state(false);
	let error = $state('');
	let wtfPath = $state('');
	let treeNodes = $state<WtfTreeNodeModel[]>([]);

	let selectedInstallation = $derived(
		installations.find((inst) => inst.id === selectedInstallationId)
	);
	let selectedInstallationLabel = $derived(selectedInstallation?.displayName ?? '');

	const addonFolderExists = (fileName: string, addonFolders: AddonFolder[]): boolean =>
		addonFolders.some((af) => af.name === removeExtension(fileName));

	function createTreeNodes(wtfNodes: WtfNode[], addonFolders: AddonFolder[]): WtfTreeNodeModel[] {
		return wtfNodes.map((wtfNode) => {
			const name = wtfNode.isDirectory
				? `${wtfNode.name} (${wtfNode.children.length} files ${formatSize(wtfNode.size)})`
				: `${wtfNode.name} (${formatSize(wtfNode.size)})`;

			const node: WtfTreeNodeModel = {
				name,
				children: createTreeNodes(wtfNode.children, addonFolders),
				warn: false,
				ignore: wtfNode.ignore
			};

			// Warn on a saved-variable file whose addon is no longer installed.
			if (!wtfNode.ignore && wtfNode.isLua) {
				node.warn = !addonFolderExists(node.name, addonFolders);
			}

			return node;
		});
	}

	async function loadWtfStructure(installation: WowInstallation | undefined) {
		if (!installation) return;

		loading = true;
		error = '';
		treeNodes = [];
		wtfPath = wtf.getWtfPath(installation);

		try {
			const addonFolders = await warcraft.listAddons(installation);
			const wtfTree = await wtf.getWtfContents(installation);
			treeNodes = createTreeNodes(wtfTree.children, addonFolders);
		} catch (e) {
			console.error(e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	// Mounting the panel is the lazy-load trigger.
	$effect(() => {
		if (selectedInstallationId === '' && installations.length > 0) {
			selectedInstallationId = installations[0].id;
		}
	});

	$effect(() => {
		const installation = selectedInstallation;
		if (installation) void loadWtfStructure(installation);
	});
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.WTF_EXPLORER.TITLE')}</h2>
	<p class="text-2 pre-wrap">{t('PAGES.OPTIONS.WTF_EXPLORER.PAGE_EXPLANATION')}</p>
	<div class="divider"></div>

	<div class="row">
		<label class="field grow">
			<span class="field-label">{t('PAGES.GET_ADDONS.CLIENT_TYPE_SELECT_LABEL')}</span>
			<select bind:value={selectedInstallationId}>
				{#each installations as installation (installation.id)}
					<option value={installation.id}>{installation.displayName}</option>
				{/each}
			</select>
		</label>
		<button
			class="wu-btn wu-btn-primary"
			disabled={loading}
			onclick={() => void loadWtfStructure(selectedInstallation)}
		>
			Refresh
		</button>
	</div>

	{#if loading}
		<div class="account-container">
			<h4><i>Loading {selectedInstallationLabel}...</i></h4>
		</div>
	{/if}

	{#if error !== ''}
		<div class="account-container text-warning">
			<h4>Error {selectedInstallationLabel}</h4>
			<p>{error}</p>
		</div>
	{/if}

	{#if !loading}
		<div class="tree-container">
			<p>
				<span>{t('PAGES.OPTIONS.WTF_EXPLORER.FOLDER_PATH_LABEL')}</span>
				<span>{wtfPath}</span>
			</p>
			<ul class="tree">
				{#each treeNodes as node (node.name)}
					<WtfTreeNode {node} />
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 1rem;
		overflow-y: auto;
		height: 100%;
	}

	h2 {
		margin: 0 0 0.5rem;
	}

	.pre-wrap {
		white-space: pre-wrap;
	}

	.divider {
		margin: 1rem 0;
		border-top: 1px solid var(--overlay-selected);
	}

	.row {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.grow {
		flex: 1;
	}

	.field-label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-bottom: 0.2rem;
	}

	select {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.tree {
		margin: 0;
		padding: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}

	.text-warning {
		color: #ffb74d;
	}
</style>
