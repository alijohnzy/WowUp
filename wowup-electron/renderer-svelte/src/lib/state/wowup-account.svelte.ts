// Port of src/app/services/wowup/wowup-account.service.ts (207 LOC, 3 BehaviorSubjects).
//
// Note: FEATURE_ACCOUNTS_ENABLED is `false` in src/common/constants.ts, so the Angular
// service returns early from its constructor and none of this runs today. It is ported
// rather than dropped because — unlike the analytics service — the code path is intact and
// re-enabling is a one-line change, not a rewrite.

import {
	ACCT_FEATURE_KEYS,
	ACCT_PUSH_ENABLED_KEY,
	APP_PROTOCOL_NAME,
	FEATURE_ACCOUNTS_ENABLED,
	IPC_PUSH_INIT,
	IPC_PUSH_REGISTER,
	IPC_PUSH_SUBSCRIBE,
	IPC_PUSH_UNREGISTER
} from '$common/constants';
import type { WowUpGetAccountResponse } from 'wowup-lib-core';
import { invoke, platform } from '$lib/ipc';
import { preferenceStorage } from '$lib/services/storage';
import * as wowUpApi from '$lib/services/wowup-api';
import { getProtocol } from '$lib/utils/string';
import { openExternalLink } from '$lib/services/links';
import { electron } from '$lib/state/electron.svelte';
import { AppConfig } from '$config/environment';

const STORAGE_WOWUP_AUTH_TOKEN = 'wowup_auth_token';

class WowUpAccount {
	authToken = $state('');
	account = $state<WowUpGetAccountResponse | undefined>(undefined);
	pushEnabled = $state(false);

	/** Was `wowUpAccount$.pipe(map(a => a !== undefined))` consumed by an `| async`. */
	authenticated = $derived(this.account !== undefined);

	#started = false;

	start(): void {
		if (this.#started || !FEATURE_ACCOUNTS_ENABLED) return;
		this.#started = true;

		electron.customProtocol.subscribe(this.#handleLoginProtocol);
		this.#loadAuthToken();
	}

	getAccountPushEnabled = async (): Promise<boolean> =>
		(await preferenceStorage.getAsync(ACCT_PUSH_ENABLED_KEY)) === 'true';

	setAccountPushEnabled = (enabled: boolean): Promise<void> =>
		preferenceStorage.setAsync(ACCT_PUSH_ENABLED_KEY, enabled);

	#loadAuthToken(): void {
		const storedToken = window.localStorage.getItem(STORAGE_WOWUP_AUTH_TOKEN);
		if (storedToken) {
			console.debug('loaded auth token', storedToken);
			this.#setAuthToken(storedToken);
		}
	}

	#setAuthToken(token: string): void {
		this.authToken = token;
		// Was a filter(token => token.length > 10) + switchMap in the constructor.
		if (token && token.length > 10) {
			void this.#onAuthTokenChanged(token);
		}
	}

	async #onAuthTokenChanged(token: string): Promise<void> {
		try {
			this.account = await wowUpApi.getAccount(token);
			this.pushEnabled = await this.getAccountPushEnabled();
		} catch (e) {
			console.error('Failed to load account', e);
			this.account = undefined;
		}
	}

	/** Handles the post-login protocol message: wowup://login/desktop/#{token} */
	#handleLoginProtocol = (protocol: string): void => {
		if (getProtocol(protocol) !== APP_PROTOCOL_NAME) return;

		const parts = protocol.split('/');
		if (parts[2] !== 'login' || parts[3] !== 'desktop') return;

		const token = parts[4];
		if (typeof token !== 'string' || token.length < 10) {
			console.warn('Invalid auth token', protocol);
			return;
		}

		console.debug('GOT WOWUP PROTOCOL', protocol);
		window.localStorage.setItem(STORAGE_WOWUP_AUTH_TOKEN, token);
		this.#setAuthToken(token);
	};

	/** Hands off to the website; the answer comes back as a wowup://login/desktop protocol hit. */
	login(): void {
		void openExternalLink(`${AppConfig.wowUpWebsiteUrl}/login?client=desktop`).catch((e: unknown) =>
			console.error(e)
		);
	}

	logout(): void {
		window.localStorage.removeItem(STORAGE_WOWUP_AUTH_TOKEN);
		this.authToken = '';
		this.account = undefined;
	}

	// ---- push ---------------------------------------------------------------------

	async toggleAccountPush(enabled: boolean): Promise<void> {
		try {
			const config = this.account?.config;
			if (!config) throw new Error('No account config');

			if (enabled) {
				await this.initializePush();
				await this.registerForPush(this.authToken, config.pushAppId);

				if (config.pushChannels?.addonUpdates) {
					await this.#subscribe(config.pushChannels.addonUpdates);
				}
			} else {
				await this.unregisterForPush(this.authToken, config.pushAppId);
			}

			await this.setAccountPushEnabled(enabled);
			this.pushEnabled = enabled;
		} catch (e) {
			console.error('Failed to toggle account push', e);
			throw e;
		}
	}

	initializePush = (): Promise<boolean> => invoke(IPC_PUSH_INIT);

	async registerForPush(authToken: string, pushAppId: string): Promise<string> {
		const pushToken = await invoke<string>(IPC_PUSH_REGISTER, pushAppId);
		await wowUpApi.registerPushToken(authToken, pushToken, platform());
		return pushToken;
	}

	async unregisterForPush(authToken: string, pushAppId: string): Promise<void> {
		const pushToken = await invoke<string>(IPC_PUSH_REGISTER, pushAppId);
		await invoke(IPC_PUSH_UNREGISTER);
		await wowUpApi.removePushToken(authToken, pushToken);
	}

	#subscribe = (channel: string): Promise<void> => invoke(IPC_PUSH_SUBSCRIBE, channel);

	async resetAccountPreferences(): Promise<void> {
		for (const key of ACCT_FEATURE_KEYS) {
			await preferenceStorage.setAsync(key, false);
		}
	}
}

export const wowUpAccount = new WowUpAccount();
