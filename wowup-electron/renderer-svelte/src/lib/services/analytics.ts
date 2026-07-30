// Port of src/app/services/analytics/analytics.service.ts (124 LOC).
//
// DELIBERATELY REDUCED. In the Angular tree `getTelemetryEnabled()` is:
//
//     public async getTelemetryEnabled(): Promise<boolean> {
//       return Promise.resolve(false);
//       // ...real implementation commented out...
//     }
//
// so ApplicationInsights is never configured and no telemetry is ever sent. Carrying over
// @microsoft/applicationinsights-web (~128 KB raw across 4 packages in the measured Angular
// bundle) would be porting dead code and shipping a analytics SDK that does nothing.
//
// The preference is preserved so the Options UI keeps working and re-enabling is a matter of
// restoring the transport here — nothing else in the app changes.

import { TELEMETRY_ENABLED_KEY } from '$common/constants';
import { preferenceStorage } from '$lib/services/storage';

export const shouldPromptTelemetry = async (): Promise<boolean> =>
	(await preferenceStorage.getAsync(TELEMETRY_ENABLED_KEY)) === undefined;

/** Always false today — see the note above. */
export const getTelemetryEnabled = async (): Promise<boolean> => Promise.resolve(false);

export const setTelemetryEnabled = (value: boolean): Promise<void> =>
	preferenceStorage.setAsync(TELEMETRY_ENABLED_KEY, value);

/** No-op transport. Kept so call sites read the same as before. */
export function trackAction(action: string, properties?: Record<string, unknown>): void {
	console.debug('[analytics]', action, properties ?? {});
}
