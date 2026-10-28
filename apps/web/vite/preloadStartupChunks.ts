import type { HtmlTagDescriptor, Plugin } from "vite-plus";

// `main` is what the entry imports first; `_chat` is the shell route it loads after the auth
// request. A renamed chunk only drops its preload hint.
const APP_CHUNK_NAME = "main";
const SHELL_ROUTE_CHUNK_NAME = "_chat";

interface ChunkInfo {
  readonly type: "chunk";
  readonly name: string;
  readonly isEntry: boolean;
  readonly imports: ReadonlyArray<string>;
}

function isChunk(value: unknown): value is ChunkInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "chunk" &&
    "imports" in value &&
    Array.isArray(value.imports)
  );
}

/**
 * Chunks the first screen needs beyond what the entry already preloads. The shell route comes
 * second because the app chunk blocks everything else.
 */
export function startupPreloadFiles(bundle: Readonly<Record<string, unknown>>) {
  const chunks = Object.entries(bundle).flatMap(([fileName, chunk]) =>
    isChunk(chunk) ? [[fileName, chunk] as const] : [],
  );
  const closure = (roots: ReadonlyArray<string>) => {
    const seen = new Set<string>();
    const pending = [...roots];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const chunk = bundle[file];
      if (isChunk(chunk)) pending.push(...chunk.imports);
    }
    return seen;
  };
  const filesNamed = (name: string) =>
    chunks.filter(([, chunk]) => chunk.name === name && !chunk.isEntry).map(([file]) => file);

  const entry = closure(chunks.filter(([, chunk]) => chunk.isEntry).map(([file]) => file));
  const app = [...closure(filesNamed(APP_CHUNK_NAME))].filter((file) => !entry.has(file));
  const appSet = new Set(app);
  const shell = [...closure(filesNamed(SHELL_ROUTE_CHUNK_NAME))].filter(
    (file) => !entry.has(file) && !appSet.has(file),
  );
  return { app, shell };
}

// Without this, the browser learns about these chunks only after the entry runs and, for the
// shell route, after the auth request: two serial waves of several megabytes.
export function preloadStartupChunksPlugin(): Plugin {
  let base = "/";
  return {
    name: "t3code:preload-startup-chunks",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        if (!context.bundle) return;
        const { app, shell } = startupPreloadFiles(context.bundle);
        const tag = (file: string, lowPriority: boolean): HtmlTagDescriptor => ({
          tag: "link",
          attrs: {
            rel: "modulepreload",
            crossorigin: true,
            ...(lowPriority ? { fetchpriority: "low" } : {}),
            href: `${base}${file}`,
          },
          injectTo: "head",
        });
        return [...app.map((file) => tag(file, false)), ...shell.map((file) => tag(file, true))];
      },
    },
  };
}
