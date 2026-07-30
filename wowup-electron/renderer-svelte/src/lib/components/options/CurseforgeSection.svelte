<script lang="ts">
	// Port of components/options/options-curseforge-section (46 LOC).

	import { IPC_OW_OPEN_CMP } from '$common/constants';
	import { t } from '$lib/i18n.svelte';
	import { invoke } from '$lib/ipc';

	function onClickManage() {
		invoke(IPC_OW_OPEN_CMP).catch((e: unknown) => console.error('onClickManage failed', e));
	}
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.CURSEFORGE.TITLE')}</h2>

	<div class="toggle">
		<div class="row">
			<div class="grow label">{t('PAGES.OPTIONS.CURSEFORGE.ADS_OPTION_LABEL')}</div>
			<button class="wu-btn wu-btn-primary" onclick={onClickManage}>
				{t('PAGES.OPTIONS.CURSEFORGE.ADS_OPTION_MANAGE')}
			</button>
		</div>
		<small class="text-2">{t('PAGES.OPTIONS.CURSEFORGE.ADS_OPTION_DESCRIPTION')}</small>
		<div class="divider"></div>
	</div>
</div>

<style>
	.container {
		padding: 1rem;
		overflow-y: auto;
		height: 100%;
	}

	h2 {
		margin-top: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.grow {
		flex: 1;
	}

	.divider {
		margin-top: 1rem;
		border-top: 1px solid var(--overlay-selected);
	}
</style>
