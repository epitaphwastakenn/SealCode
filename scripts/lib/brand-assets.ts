const HARP_ICON_PATHS = {
  macPng: "assets/harp/harp-icon-macos.png",
  ico: "assets/harp/harp-icon.ico",
  favicon16Png: "assets/harp/harp-icon-16.png",
  favicon32Png: "assets/harp/harp-icon-32.png",
  appleTouchIconPng: "assets/harp/harp-icon-180.png",
} as const;

// Every channel ships the same Harp icon; the keys stay per channel so one can diverge later.
export const BRAND_ASSET_PATHS = {
  productionMacIconPng: HARP_ICON_PATHS.macPng,
  productionWindowsIconIco: HARP_ICON_PATHS.ico,
  productionWebFaviconIco: HARP_ICON_PATHS.ico,
  productionWebFavicon16Png: HARP_ICON_PATHS.favicon16Png,
  productionWebFavicon32Png: HARP_ICON_PATHS.favicon32Png,
  productionWebAppleTouchIconPng: HARP_ICON_PATHS.appleTouchIconPng,

  nightlyMacIconPng: HARP_ICON_PATHS.macPng,
  nightlyWindowsIconIco: HARP_ICON_PATHS.ico,
  nightlyWebFaviconIco: HARP_ICON_PATHS.ico,
  nightlyWebFavicon16Png: HARP_ICON_PATHS.favicon16Png,
  nightlyWebFavicon32Png: HARP_ICON_PATHS.favicon32Png,
  nightlyWebAppleTouchIconPng: HARP_ICON_PATHS.appleTouchIconPng,

  developmentWebFaviconIco: HARP_ICON_PATHS.ico,
  developmentWebFavicon16Png: HARP_ICON_PATHS.favicon16Png,
  developmentWebFavicon32Png: HARP_ICON_PATHS.favicon32Png,
  developmentWebAppleTouchIconPng: HARP_ICON_PATHS.appleTouchIconPng,
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export function resolveWebAssetBrandForPackageVersion(version: string): WebAssetBrand {
  return /^[^-+]+-(?:nightly|preview)\./.test(version) ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");
