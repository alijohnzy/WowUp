// Replaces @angular/material/dialog (MatDialog + MatDialogRef + MAT_DIALOG_DATA) and
// src/app/services/dialog/dialog.factory.ts.
//
// MatDialog dynamically compiled a component and returned a MatDialogRef whose
// `afterClosed()` was an Observable that every call site piped through `first()`. All of
// them wanted "await the user's answer", so that is what this exposes: `open()` returns a
// promise resolving to the dialog's result.
//
// <DialogHost /> in +layout.svelte renders the stack; native <dialog showModal()> supplies
// the modal semantics, focus trap and Escape handling the CDK overlay was providing.

import type { AddonChannelType, AddonSearchResult } from 'wowup-lib-core';
import type { AddonViewModel } from '$lib/business-objects/addon-view-model';

export type DialogKind =
	'confirm' | 'alert' | 'externalUrl' | 'consent' | 'patchNotes' | 'addonDetail';

export interface ConfirmDialogData {
	title: string;
	message: string;
	positiveKey?: string;
	negativeKey?: string;
}

export interface AlertDialogData {
	title: string;
	message: string;
	positiveButton?: string;
	positiveButtonStyle?: 'raised' | 'flat' | 'stroked';
}

export interface ExternalUrlDialogData {
	title: string;
	message: string;
	url: string;
	domains: string[];
}

/** Result of the external-url confirmation dialog. */
export interface ExternalUrlResult {
	success: boolean;
	/** Non-empty when the user asked to trust the domain. */
	trustDomain: string;
}

/** First-run permissions prompt. Has a form body, so it gets its own kind. */
export interface ConsentDialogData {
	title: string;
	requiresCmp: boolean;
}

export interface ConsentResult {
	telemetry: boolean;
	wagoProvider: boolean;
}

/** "What's new" popup — an alert whose body is the release's HTML changelog. */
export interface PatchNotesDialogData {
	title: string;
	html: string;
}

/**
 * Was MAT_DIALOG_DATA for AddonDetailComponent. Exactly one of `listItem` (opened from My
 * Addons) or `searchResult` (opened from Get Addons) is set; the component branches on which.
 */
export interface AddonDetailData {
	listItem?: AddonViewModel;
	searchResult?: AddonSearchResult;
	channelType?: AddonChannelType;
}

export type DialogData =
	| ConfirmDialogData
	| AlertDialogData
	| ExternalUrlDialogData
	| ConsentDialogData
	| PatchNotesDialogData
	| AddonDetailData;

export type DialogResult = boolean | ExternalUrlResult | ConsentResult | undefined;

export interface OpenDialog {
	id: string;
	kind: DialogKind;
	data: DialogData;
	/** Escape and backdrop dismissal are suppressed when true (MatDialog disableClose). */
	disableClose: boolean;
	resolve: (value: DialogResult) => void;
}

class Dialogs {
	stack = $state<OpenDialog[]>([]);

	#open<T extends DialogResult>(
		kind: DialogKind,
		data: DialogData,
		disableClose: boolean
	): Promise<T> {
		return new Promise<T>((resolve) => {
			this.stack.push({
				id: crypto.randomUUID(),
				kind,
				data,
				disableClose,
				resolve: resolve as (value: DialogResult) => void
			});
		});
	}

	/** Resolves true if the user confirmed. */
	confirm = (data: ConfirmDialogData, disableClose = false): Promise<boolean> =>
		this.#open<boolean>('confirm', data, disableClose);

	/** Resolves once the user acknowledges. */
	alert = (data: AlertDialogData, disableClose = false): Promise<boolean> =>
		this.#open<boolean>('alert', data, disableClose);

	/** Resolves with whether to navigate, and whether to trust the domain. */
	externalUrl = (data: ExternalUrlDialogData): Promise<ExternalUrlResult> =>
		this.#open<ExternalUrlResult>('externalUrl', data, false);

	/** First-run permissions. `undefined` if dismissed without submitting. */
	consent = (data: ConsentDialogData): Promise<ConsentResult | undefined> =>
		this.#open<ConsentResult | undefined>('consent', data, true);

	/** "What's new" popup. Resolves once acknowledged. */
	patchNotes = (data: PatchNotesDialogData): Promise<boolean> =>
		this.#open<boolean>('patchNotes', data, false);

	/** Addon detail. Renders its own chrome, so DialogHost delegates rather than wrapping. */
	addonDetail = (data: AddonDetailData): Promise<boolean> =>
		this.#open<boolean>('addonDetail', data, false);

	close(id: string, result: DialogResult): void {
		const idx = this.stack.findIndex((d) => d.id === id);
		if (idx === -1) return;
		const [dialog] = this.stack.splice(idx, 1);
		dialog.resolve(result);
	}

	/** Dismissal without an explicit answer — Escape, backdrop, or the close button. */
	dismiss(id: string): void {
		const dialog = this.stack.find((d) => d.id === id);
		if (!dialog) return;

		switch (dialog.kind) {
			case 'externalUrl':
				this.close(id, { success: false, trustDomain: '' });
				break;
			case 'consent':
				// No consent given is materially different from consent denied.
				this.close(id, undefined);
				break;
			default:
				this.close(id, false);
		}
	}
}

export const dialogs = new Dialogs();
