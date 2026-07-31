// Tauri flavour: the CurseForge provider *and* the Wago ad frame.
//
// The `ow` flavour it derives from gets its ad from `<owadview>`, a custom element supplied
// by @overwolf/ow-electron. Tauri runs WebKitGTK/WebView2, which has no such element and no
// Overwolf ad SDK, so that flavour renders an empty box — the ad slot is reserved and stays
// blank. The Wago ad is an ordinary web page, so it is the only one that ports.
//
// Wago is therefore enabled for its ad *and* as a provider: the ad frame hands back an API
// token (assets/preload/wago.js -> `wago-token-received`), so leaving the provider off would
// mean displaying Wago's ad while never using what it pays for. Enabling it also restores the
// Wago section in Options, which the `ow` flavour hides.

export const AppConfig = {
  production: true,
  environment: "PROD",
  wowUpWebsiteUrl: "https://wowup.io",
  wowUpApiUrl: "https://api.wowup.io",
  wowUpHubUrl: "https://hub.wowup.io",
  wowupRepositoryUrl: "https://github.com/WowUp/WowUp",
  warcraftTavernNewsFeedUrl:
    "https://www.warcrafttavern.com/?call_custom_simple_rss=1&csrp_post_type=wow-classic-news,tbc-classic-news,retail-news&csrp_thumbnail_size=medium",
  azure: {
    applicationInsightsKey: "4a53e8d9-796c-4f80-b1a6-9a058374dd6d",
  },
  wago: {
    enabled: true,
    termsUrl: "https://addons.wago.io/agreements/terms-of-service",
    dataConsentUrl: "https://addons.wago.io/agreements/wowup-data-consent",
  },
  curseforge: {
    enabled: true,
    httpTimeoutMs: 60000,
    apiKey: "{{CURSEFORGE_API_KEY}}",
  },
  autoUpdateIntervalMs: 3600000, // 1 hour
  appUpdateIntervalMs: 3600000, // 1 hour
  defaultHttpTimeoutMs: 10000,
  defaultHttpResetTimeoutMs: 30000,
  wowUpHubHttpTimeoutMs: 10000,
  wagoHttpTimeoutMs: 10000,
  newsRefreshIntervalMs: 3600000, // 1 hour
  featuredAddonsCacheTimeSec: 30, // 30 sec
};
