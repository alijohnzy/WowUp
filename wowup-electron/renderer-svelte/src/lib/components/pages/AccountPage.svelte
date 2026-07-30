<script lang="ts">
	// Port of src/app/pages/account-page/account-page.component.{ts,html} (164 LOC).
	//
	// The Angular template piped `"Instant Updates" | translate` — running the English copy
	// through the translate pipe as if it were a key. ngx-translate returns the input
	// unchanged when a key is missing, so it rendered correctly and silently. Those strings
	// are literals here; treating them as keys would only hide the fact that they were never
	// added to the locale files.
	//
	// The logout confirmation was a MatDialog + afterClosed().pipe(map, catchError); it is an
	// awaited dialogs.confirm().

	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import { isLinux, isMac, isWin } from '$lib/ipc';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wowUpAccount } from '$lib/state/wowup-account.svelte';
	import { openExternalLink } from '$lib/services/links';
	import Toggle from '$lib/components/common/Toggle.svelte';

	async function onTogglePush(checked: boolean) {
		try {
			await session.toggleAccountPush(checked);
		} catch (e) {
			console.error('Failed to toggle account push', e);
			snackbar.showError('COMMON.ERRORS.ACCOUNT_PUSH_TOGGLE_FAILED_ERROR');
		}
	}

	async function onClickLogout() {
		const confirmed = await dialogs.confirm({
			title: t('PAGES.ACCOUNT.LOGOUT_CONFIRMATION_TITLE'),
			message: t('PAGES.ACCOUNT.LOGOUT_CONFIRMATION_MESSAGE')
		});
		if (confirmed) session.logout();
	}

	async function onClickManageAccount() {
		await openExternalLink(`${AppConfig.wowUpWebsiteUrl}/account`);
	}
</script>

<div class="tab-container" class:mac={isMac()} class:windows={isWin()} class:linux={isLinux()}>
	<div class="theme-logo">
		<div class="logo-img"></div>
	</div>

	<div class="control-container text-1">
		<div class="account-container bg-secondary-4 rounded">
			<h1>
				{t('PAGES.ACCOUNT.TITLE')}
				<span class="text-control"><i><sup>{t('PAGES.ACCOUNT.BETA')}</sup></i></span>
			</h1>

			{#if wowUpAccount.authenticated}
				<h3>You're logged in!</h3>
				<p>
					You're now able to access our various cloud services to help you maximize your addon
					experience.
				</p>

				<div class="toggle-row">
					<div class="toggle-label">
						<div>Instant Updates</div>
						<small class="text-2">
							No more waiting for timers, get updates as soon as we see them
						</small>
					</div>
					<Toggle
						checked={wowUpAccount.pushEnabled}
						onCheckedChange={(checked) => void onTogglePush(checked)}
					/>
				</div>

				<div class="toggle-row">
					<div class="toggle-label">
						<div>Cloud Addon Sync</div>
						<small class="text-2">
							The simplest way to manage your addon backups for all your machines
						</small>
					</div>
					<Toggle checked={false} disabled />
				</div>

				<div class="toggle-row">
					<div class="toggle-label">
						<div>Cloud Settings Sync</div>
						<small class="text-2">
							Easy to use, hopefully, way to manage your settings between characters and machines
						</small>
					</div>
					<Toggle checked={false} disabled />
				</div>

				<div class="button-row">
					<button class="wu-btn wu-btn-warning" onclick={() => void onClickLogout()}>
						{t('PAGES.ACCOUNT.LOGOUT_BUTTON')}
					</button>
					<div class="spacer"></div>
					<button class="wu-btn wu-btn-primary" onclick={() => void onClickManageAccount()}>
						{t('PAGES.ACCOUNT.MANAGE_ACCOUNT_BUTTON')}
					</button>
				</div>
			{:else}
				<p>Login now to get the most out of your WowUp application.</p>
				<p>
					We're working on bringing in some optional cloud based services that we think can really
					enhance your addon management experience.
				</p>
				<p>
					By clicking the login button you will be taken to the WowUp website to start the process.
				</p>

				<div class="button-row center">
					<button class="wu-btn wu-btn-flat wu-btn-primary" onclick={() => session.login()}>
						{t('PAGES.ACCOUNT.LOGIN_BUTTON')}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.tab-container {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.theme-logo {
		display: flex;
		justify-content: center;
		padding: 1.5rem 0;
	}

	.control-container {
		display: flex;
		justify-content: center;
		padding: 0 1rem 1.5rem;
	}

	.account-container {
		width: min(36rem, 100%);
		padding: 1rem;
		box-shadow: 0 8px 10px 1px rgb(0 0 0 / 14%);
	}

	.account-container h1 {
		margin-top: 0;
	}

	.text-control {
		font-size: 0.5em;
		opacity: 0.8;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 0;
	}

	.toggle-label {
		flex: 1 1 auto;
		min-width: 0;
	}

	.button-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.button-row.center {
		justify-content: center;
	}

	.spacer {
		flex: 1 1 auto;
	}
</style>
