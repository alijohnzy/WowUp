// Port of src/app/business-objects/addon-view-model.ts (140 LOC).
//
// Kept as a class rather than turned into a $state module: it is a per-row wrapper the
// grids create in bulk, not shared app state. Only the Angular-isms go — lodash filter, and
// `object-hash` (the `hash` getter was used by Angular trackBy; Svelte's {#each} keys on
// addon.id directly, so it has no callers and is dropped).

import { ADDON_PROVIDER_UNKNOWN } from '$common/constants';
import { AddonInstallState } from '$lib/models/addon-install-state';
import { AddonStatusSortOrder } from '$lib/models/addon-status-sort-order';
import * as addonUtils from '$lib/utils/addon';
import {
	AddonChannelType,
	type Addon,
	type AddonDependency,
	type AddonDependencyType
} from 'wowup-lib-core';

export class AddonViewModel {
	addon: Addon | undefined;

	installState: AddonInstallState = AddonInstallState.Unknown;
	isInstalling = false;
	installProgress = 0;
	stateTextTranslationKey = '';
	selected = false;
	releasedAt = 0;
	installedAt = 0;
	isLoadOnDemand = false;
	hasThumbnail = false;
	thumbnailLetter = '';
	canonicalName = '';

	constructor(addon: Addon | undefined) {
		this.addon = addon;
		this.installedAt = addon?.installedAt ? new Date(addon.installedAt).getTime() : 0;
		this.releasedAt = addon?.releasedAt ? new Date(addon.releasedAt).getTime() : 0;
		this.stateTextTranslationKey = this.getStateTextTranslationKey();
		this.isLoadOnDemand = addon?.isLoadOnDemand ?? false;
		this.hasThumbnail = !!addon?.thumbnailUrl;
		this.thumbnailLetter = addon?.name?.charAt(0).toUpperCase() ?? '';
		this.canonicalName = addon?.name?.toLowerCase() ?? '';
	}

	get isIgnored(): boolean {
		return this.addon?.isIgnored ?? false;
	}
	get name(): string {
		return this.addon?.name ?? '';
	}
	get latestVersion(): string {
		return this.addon?.latestVersion ?? '';
	}
	get gameVersion(): string[] {
		return this.addon?.gameVersion ?? [];
	}
	get externalChannel(): string {
		return this.addon?.externalChannel ?? '';
	}
	get providerName(): string {
		return this.addon?.providerName ?? '';
	}
	get author(): string {
		return this.addon?.author ?? '';
	}

	isUpToDate = (): boolean => !this.isInstalling && !addonUtils.needsUpdate(this.addon);
	isStableChannel = (): boolean => this.addon?.channelType === AddonChannelType.Stable;
	isBetaChannel = (): boolean => this.addon?.channelType === AddonChannelType.Beta;
	isAlphaChannel = (): boolean => this.addon?.channelType === AddonChannelType.Alpha;
	isUnMatched = (): boolean => this.addon?.providerName === ADDON_PROVIDER_UNKNOWN;

	clone = (): AddonViewModel => new AddonViewModel(this.addon);

	onClicked(): void {
		this.selected = !this.selected;
	}

	needsInstall = (): boolean =>
		!this.isInstalling && this.addon !== undefined && addonUtils.needsInstall(this.addon);

	needsUpdate = (): boolean =>
		!this.isInstalling && this.addon !== undefined && addonUtils.needsUpdate(this.addon);

	get sortOrder(): AddonStatusSortOrder {
		if (this.addon?.isIgnored) return AddonStatusSortOrder.Ignored;
		if (this.addon?.warningType) return AddonStatusSortOrder.Warning;
		if (this.needsInstall()) return AddonStatusSortOrder.Install;
		if (this.needsUpdate() || this.isInstalling) return AddonStatusSortOrder.Update;
		if (this.isUpToDate()) return AddonStatusSortOrder.UpToDate;
		return AddonStatusSortOrder.Unknown;
	}

	getStateTextTranslationKey(): string {
		if (this.isUpToDate()) return 'COMMON.ADDON_STATE.UPTODATE';
		if (this.addon?.isIgnored) return 'COMMON.ADDON_STATE.IGNORED';
		if (this.needsUpdate()) return 'COMMON.ADDON_STATE.UPDATE';
		if (this.needsInstall()) return 'COMMON.ADDON_STATE.INSTALL';

		console.warn('Unhandled display state', this.isUpToDate(), this.addon?.name);
		return 'COMMON.ADDON_STATE.UNKNOWN';
	}

	getDependencies(dependencyType: AddonDependencyType | undefined = undefined): AddonDependency[] {
		const dependencies = this.addon?.dependencies ?? [];
		if (dependencyType === undefined) return dependencies;
		return dependencies.filter((dep) => dep.type === dependencyType);
	}
}
