import type { Addon } from 'wowup-lib-core';
import type { AddonInstallState } from './addon-install-state';

export interface AddonUpdateEvent {
	addon: Addon;
	installState: AddonInstallState;
	progress: number;
}
