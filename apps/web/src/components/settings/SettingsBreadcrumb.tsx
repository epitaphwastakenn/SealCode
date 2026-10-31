import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

const settingsPageTitles: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

function settingsPageTitle(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return settingsPageTitles[normalizedPathname] ?? "Settings";
}

export function SettingsPageTitle({ pathname }: { pathname: string }) {
  return (
    <h1 className="min-w-0 truncate text-sm font-medium text-foreground">
      {settingsPageTitle(pathname)}
    </h1>
  );
}
