// Each WoW client has a color, so the addon tables say which client they belong to at a glance:
// My Addons and Get Addons frame their table with the selected client's color, and the client
// selector and "Installed in" hints mark each client with it.
//
// The live clients take their color from their logo's artwork — Midnight's violet, Mists of
// Pandaria's jade, Classic's gold, The Burning Crusade's fel green. The bundled logos are
// grayscale watermarks, so these come from the official logos rather than those files. Test
// clients share their game's logo but get a hue of their own: a PTR framed like the live
// client would defeat the point. The user can pick any color per client in Options → Clients.

import { WowClientType, type WowInstallation } from 'wowup-lib-core';

export const DEFAULT_CLIENT_COLORS: Record<WowClientType, string | undefined> = {
	[WowClientType.Retail]: '#9d6cff',
	[WowClientType.RetailPtr]: '#ff8a3d',
	[WowClientType.RetailXPtr]: '#ff5c7a',
	[WowClientType.Beta]: '#e05ad8',
	[WowClientType.Classic]: '#22b89a',
	[WowClientType.ClassicPtr]: '#3fc5e0',
	[WowClientType.ClassicBeta]: '#a8a8c0',
	[WowClientType.ClassicEra]: '#e3b02a',
	[WowClientType.ClassicEraPtr]: '#c47f45',
	[WowClientType.Anniversary]: '#7cc63a',
	[WowClientType.Forever]: '#4a90ff',
	[WowClientType.None]: undefined
};

export interface ColorSwatch {
	color: string;
	/** The client type this is the default of, which names it. */
	clientType: WowClientType;
}

/**
 * One-click choices next to the custom picker: every client type's default, `own`'s first —
 * picking it again is how a custom color is undone.
 */
export function colorSwatches(own?: WowClientType): ColorSwatch[] {
	const swatches = Object.entries(DEFAULT_CLIENT_COLORS)
		.filter((entry): entry is [string, string] => !!entry[1])
		.map(([type, color]) => ({ color, clientType: Number(type) as WowClientType }));
	return [
		...swatches.filter((s) => s.clientType === own),
		...swatches.filter((s) => s.clientType !== own)
	];
}

/** What `<input type="color">` produces, and all a stored color may be. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isClientColor(value: unknown): value is string {
	return typeof value === 'string' && HEX_COLOR.test(value);
}

export function defaultClientColor(clientType: WowClientType | undefined): string | undefined {
	return clientType === undefined ? undefined : DEFAULT_CLIENT_COLORS[clientType];
}

/** The installation's chosen color, else its client type's default. */
export function clientColor(
	installation: Pick<WowInstallation, 'clientType' | 'color'> | undefined
): string | undefined {
	if (!installation) return undefined;
	return isClientColor(installation.color)
		? installation.color.toLowerCase()
		: defaultClientColor(installation.clientType);
}
