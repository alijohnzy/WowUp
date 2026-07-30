// Port of src/app/services/snackbar/snackbar.service.ts (46 LOC) +
// components/common/centered-snackbar/centered-snackbar.component.ts (22 LOC).
//
// MatSnackBar.openFromComponent() dynamically instantiated an Angular component to show a
// line of text. Here the message is state and <Snackbar.svelte> renders it.
//
// One at a time, because that is what MatSnackBar does: opening a snack bar dismisses whichever
// is showing. The first version of this kept an array and rendered every entry, which looked
// fine for the one-off successes it was tested with. It is not one-off in the failure case:
// syncStandardProviders emits a sync error per provider *per installation*, and
// syncBatchProviders adds more, so a single CurseForge outage with two WoW installations
// produced ~20 identical toasts stacked over the entire window — the app was unusable until
// they timed out. The Angular original raises exactly as many errors; it just never shows more
// than one.

import { i18n } from '$lib/i18n.svelte';

export interface SnackbarConfig {
	timeout?: number;
	classes?: string[];
	localeArgs?: Record<string, unknown>;
}

export interface Toast {
	id: string;
	message: string;
	classes: string[];
}

class Snackbars {
	/** The one showing, if any. */
	current = $state<Toast | undefined>(undefined);

	#timer: ReturnType<typeof setTimeout> | undefined;

	show(localeKey: string, config?: SnackbarConfig): string {
		const id = crypto.randomUUID();

		// Replaces rather than appends. The outgoing toast's timer is cleared so it cannot
		// dismiss the incoming one part-way through its own display time.
		clearTimeout(this.#timer);
		this.current = {
			id,
			message: i18n.t(localeKey, config?.localeArgs),
			classes: ['wowup-snackbar', 'text-1', ...(config?.classes ?? [])]
		};

		const timeout = config?.timeout ?? 5000;
		if (timeout > 0) this.#timer = setTimeout(() => this.dismiss(id), timeout);
		return id;
	}

	showSuccess = (localeKey: string, config?: SnackbarConfig): string =>
		this.show(localeKey, { ...config, classes: [...(config?.classes ?? []), 'snackbar-success'] });

	showError = (localeKey: string, config?: SnackbarConfig): string =>
		this.show(localeKey, { ...config, classes: [...(config?.classes ?? []), 'snackbar-error'] });

	/** No-op if the id is not the one showing — a stale timer must not close a newer message. */
	dismiss(id: string): void {
		if (this.current?.id !== id) return;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.current = undefined;
	}
}

export const snackbar = new Snackbars();
