# Brand assets

`harp/` holds the Harp app icon and logo, shared by every release channel.

- `harp-icon.svg` is the source of the app icon: a white seal balancing a ball on a violet rounded-square tile.
- `harp-icon.png` (1024), `harp-icon-180.png`, `harp-icon-32.png`, `harp-icon-16.png`, `harp-icon-256.png` and `harp-icon.ico` (16 to 256) are rasterized from it. `harp-icon-macos.png` is the same icon scaled to 824 px and centered on a 1024 px canvas with a soft shadow, the safe area macOS app icons use.
- `harp-logo.svg` is the flat mark in `currentColor`. `apps/web/src/components/HarpMark.tsx` inlines its paths.

`scripts/lib/brand-assets.ts` maps these files to the desktop build (Windows `.ico`, macOS `.icns` made from `harp-icon-macos.png`) and to the web favicons. `apps/web/public` carries committed copies of the favicons, the apple-touch icon and the boot-shell logo, so refresh them when the icon changes.

`sealcode/sounds` holds the notification sounds.
