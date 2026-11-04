// TukUI serves one list for every game. Get Addons offered all of it whatever the client, so a
// WoW Forever client was shown Tukui, which has no Forever release, with an empty game version.

import { TukUiAddonProvider } from '../../addon-providers';
import { MockNetworkInterface } from '../../mocks/mock-network-interface';
import { createMockWowInstallation } from '../../mocks/mock-wow-installation';
import { WowClientType } from '../../types';

// The two addons as api.tukui.org/v1/addons listed them on 2026-11-04, trimmed to what's used.
const TUKUI_ADDONS = [
  { id: -2, name: 'ElvUI', patch: ['12.1.5', '1.60.1', '5.5.4', '1.15.9', '2.5.6'] },
  { id: -1, name: 'Tukui', patch: ['11.1.7', '5.5.0', '1.15.7'] },
].map((a) => ({
  ...a,
  slug: a.name.toLowerCase(),
  author: 'Tukui',
  url: `https://api.tukui.org/v1/download/${a.name.toLowerCase()}.zip`,
  version: '1.0',
  last_update: '2026-11-01',
  web_url: '',
  small_desc: '',
  screenshot_url: '',
  directories: [a.name],
}));

class FixtureNetwork extends MockNetworkInterface {
  public override async getJson<T>(): Promise<T> {
    return JSON.parse(JSON.stringify(TUKUI_ADDONS)) as T;
  }
}

const provider = new TukUiAddonProvider(new FixtureNetwork());
const installation = (clientType: WowClientType) => ({ ...createMockWowInstallation(), clientType });
const names = (results: { name: string }[]) => results.map((r) => r.name).sort();

test('Get Addons lists only addons with a release for the client', async () => {
  expect(names(await provider.getFeaturedAddons(installation(WowClientType.Forever)))).toEqual(['ElvUI']);
  expect(names(await provider.getFeaturedAddons(installation(WowClientType.Retail)))).toEqual(['ElvUI', 'Tukui']);
  expect(names(await provider.getFeaturedAddons(installation(WowClientType.Anniversary)))).toEqual(['ElvUI']);
});

test('search leaves out addons without a release for the client', async () => {
  expect(names(await provider.searchByQuery('tukui', installation(WowClientType.Forever)))).toEqual([]);
  expect(names(await provider.searchByQuery('tukui', installation(WowClientType.Retail)))).toEqual(['Tukui']);
});

test('the Forever release is the 1.60 patch, not Classic Era 1.15', async () => {
  const [elvui] = await provider.getFeaturedAddons(installation(WowClientType.Forever));
  expect(elvui.files?.[0].gameVersion).toBe('1.60.1');
});

// An installed addon must stay matchable, or it could never be updated or removed cleanly.
test('getById still finds an addon whatever the client', async () => {
  const result = await provider.getById('-1', installation(WowClientType.Forever));
  expect(result?.name).toBe('Tukui');
});
