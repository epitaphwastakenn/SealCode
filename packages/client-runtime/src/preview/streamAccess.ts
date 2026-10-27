export interface PreviewStreamAccess {
  readonly httpBase: string;
  readonly wsBase: string;
  readonly query: Readonly<Record<string, string>>;
  readonly credentials: boolean;
}

export const withPreviewStreamQuery = (url: string, access: PreviewStreamAccess): string => {
  const entries = Object.entries(access.query);
  if (entries.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${new URLSearchParams(entries).toString()}`;
};
