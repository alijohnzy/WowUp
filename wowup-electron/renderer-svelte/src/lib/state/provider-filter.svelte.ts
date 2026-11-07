// "Show Providers": right-click a table header on My Addons or Get Addons and untick a
// provider to hide its addons — only Wago results, say, or everything but CurseForge.
//
// Each page keeps its own choice, remembered across restarts like its hidden columns. The
// Provider header shows a filter icon while one is in force, so an addon missing from the list
// has a visible reason.

import { preferenceStorage } from '$lib/services/storage';

export const MY_ADDONS_HIDDEN_PROVIDERS_KEY = 'my_addons_hidden_providers';
export const GET_ADDONS_HIDDEN_PROVIDERS_KEY = 'get_addons_hidden_providers';

export interface ProviderOption {
	name: string;
	/** Rows from this provider in the list being filtered. */
	count: number;
	shown: boolean;
}

export class ProviderFilter {
	/** Provider names whose rows are hidden. */
	hidden = $state<string[]>([]);

	active = $derived(this.hidden.length > 0);

	#key: string;
	#loaded: Promise<void> | undefined;

	constructor(key: string) {
		this.#key = key;
	}

	/** Reads the saved choice, once. */
	load(): Promise<void> {
		this.#loaded ??= (async () => {
			const saved = await preferenceStorage
				.getObjectAsync<unknown>(this.#key)
				.catch(() => undefined);
			if (Array.isArray(saved)) {
				this.hidden = saved.filter((name): name is string => typeof name === 'string');
			}
		})();
		return this.#loaded;
	}

	shows(name: string): boolean {
		return !this.hidden.includes(name);
	}

	apply<T>(rows: T[], providerOf: (row: T) => string | undefined): T[] {
		if (!this.active) return rows;
		return rows.filter((row) => this.shows(providerOf(row) ?? ''));
	}

	/**
	 * What the menu offers: every provider in `rows`, plus any hidden one that has none there
	 * now — otherwise a provider hidden on one list could not be brought back on the next.
	 */
	options<T>(rows: T[], providerOf: (row: T) => string | undefined): ProviderOption[] {
		// A local tally, built and read in this call: nothing to track.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const counts = new Map<string, number>();
		for (const row of rows) {
			const name = providerOf(row) ?? '';
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		for (const name of this.hidden) {
			if (!counts.has(name)) counts.set(name, 0);
		}
		return [...counts]
			.map(([name, count]) => ({ name, count, shown: this.shows(name) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async set(name: string, shown: boolean): Promise<void> {
		const others = this.hidden.filter((hidden) => hidden !== name);
		await this.#save(shown ? others : [...others, name]);
	}

	async showAll(): Promise<void> {
		await this.#save([]);
	}

	async #save(hidden: string[]): Promise<void> {
		this.hidden = hidden;
		await preferenceStorage.setAsync(this.#key, hidden);
	}
}

export const myAddonsProviderFilter = new ProviderFilter(MY_ADDONS_HIDDEN_PROVIDERS_KEY);
export const getAddonsProviderFilter = new ProviderFilter(GET_ADDONS_HIDDEN_PROVIDERS_KEY);
