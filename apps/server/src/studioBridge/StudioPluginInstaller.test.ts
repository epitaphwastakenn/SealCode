import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as StudioPluginInstaller from "./StudioPluginInstaller.ts";

describe("buildPluginModel", () => {
  it("nests modules under the main script and keeps CDATA intact", () => {
    const model = StudioPluginInstaller.buildPluginModel(
      [
        { path: "Main.server.luau", source: "print('main')" },
        { path: "Handlers/Place.luau", source: "local t = a[b[1]]>0 return t" },
        { path: "Util.luau", source: "return {}" },
      ],
      StudioPluginInstaller.configModule({ port: 1234, key: "k_ey-1", pluginHash: "h" }),
    );
    expect(model).toContain('<Item class="Script" referent="RBX0">');
    expect(model).toContain('<string name="Name">Handlers</string>');
    // "]]>" inside Luau is split across two CDATA sections.
    expect(model).toContain("a[b[1]]]]><![CDATA[>0");
    expect(model).toContain('baseUrl = "http://127.0.0.1:1234"');
    expect(model).toContain('key = "k_ey-1"');
    // Deterministic, so an unchanged plugin is never rewritten.
    expect(
      StudioPluginInstaller.buildPluginModel(
        [
          { path: "Main.server.luau", source: "print('main')" },
          { path: "Handlers/Place.luau", source: "local t = a[b[1]]>0 return t" },
          { path: "Util.luau", source: "return {}" },
        ],
        StudioPluginInstaller.configModule({ port: 1234, key: "k_ey-1", pluginHash: "h" }),
      ),
    ).toBe(model);
  });
});

describe("StudioPluginInstaller", () => {
  it.effect("installs the real plugin and rewrites it only when it changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* fs.makeTempDirectoryScoped();
      const installer = yield* StudioPluginInstaller.StudioPluginInstaller.pipe(
        Effect.provide(
          StudioPluginInstaller.layer.pipe(
            Layer.provide(
              Layer.succeed(HostProcess.Environment, { SEALCODE_STUDIO_PLUGINS_DIR: folder }),
            ),
          ),
        ),
      );
      const first = yield* installer.install({ port: 58760, key: "abc" });
      expect(first.pluginHash).toMatch(/^[0-9a-f]{16}$/);
      expect(first).toMatchObject({
        path: path.join(folder, StudioPluginInstaller.PLUGIN_FILE_NAME),
        changed: true,
      });
      const text = yield* fs.readFileString(first.path);
      for (const module of ["Transport", "Router", "Panel", "Config", "Scripts", "Instances"]) {
        expect(text).toContain(`<string name="Name">${module}</string>`);
      }
      expect((yield* installer.install({ port: 58760, key: "abc" })).changed).toBe(false);
      expect((yield* installer.install({ port: 58760, key: "rotated" })).changed).toBe(true);
      expect(yield* fs.readDirectory(folder)).toEqual([StudioPluginInstaller.PLUGIN_FILE_NAME]);
      expect(yield* installer.uninstall).toBe(true);
      expect(yield* fs.readDirectory(folder)).toEqual([]);
      expect(yield* installer.uninstall).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("replaces the plugin file from before the rename instead of leaving two plugins", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* fs.makeTempDirectoryScoped();
      const legacy = path.join(folder, "SealCodeStudio.rbxmx");
      const installer = yield* StudioPluginInstaller.StudioPluginInstaller.pipe(
        Effect.provide(
          StudioPluginInstaller.layer.pipe(
            Layer.provide(
              Layer.succeed(HostProcess.Environment, { SEALCODE_STUDIO_PLUGINS_DIR: folder }),
            ),
          ),
        ),
      );

      yield* fs.writeFileString(legacy, "<roblox/>");
      const upgraded = yield* installer.install({ port: 58760, key: "abc" });
      expect(upgraded.changed).toBe(true);
      expect(yield* fs.readDirectory(folder)).toEqual(["HarpStudio.rbxmx"]);

      // A leftover next to an up to date plugin goes too, without rewriting the plugin.
      yield* fs.writeFileString(legacy, "<roblox/>");
      expect((yield* installer.install({ port: 58760, key: "abc" })).changed).toBe(false);
      expect(yield* fs.readDirectory(folder)).toEqual(["HarpStudio.rbxmx"]);

      // Turning the bridge off removes whichever copy is there.
      yield* fs.writeFileString(legacy, "<roblox/>");
      expect(yield* installer.uninstall).toBe(true);
      expect(yield* fs.readDirectory(folder)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
