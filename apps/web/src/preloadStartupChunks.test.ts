import { expect, it } from "vite-plus/test";

import { startupPreloadFiles } from "../vite/preloadStartupChunks";

const chunk = (name: string, imports: ReadonlyArray<string>, isEntry = false) => ({
  type: "chunk" as const,
  name,
  isEntry,
  imports,
});

it("preloads the app chunk first and the shell route after it, without repeats", () => {
  const bundle = {
    "assets/index.js": chunk("index", ["assets/runtime.js"], true),
    "assets/runtime.js": chunk("runtime", []),
    "assets/main.js": chunk("main", ["assets/runtime.js", "assets/react.js"]),
    "assets/react.js": chunk("react", []),
    "assets/_chat.js": chunk("_chat", ["assets/react.js", "assets/composer.js"]),
    "assets/composer.js": chunk("composer", ["assets/runtime.js"]),
    "assets/settings.js": chunk("settings", ["assets/composer.js"]),
    "assets/logo.svg": { type: "asset" },
  };

  expect(startupPreloadFiles(bundle)).toEqual({
    app: ["assets/main.js", "assets/react.js"],
    shell: ["assets/_chat.js", "assets/composer.js"],
  });
});

it("preloads nothing for a chunk that does not exist", () => {
  const bundle = { "assets/index.js": chunk("index", [], true) };

  expect(startupPreloadFiles(bundle)).toEqual({ app: [], shell: [] });
});
