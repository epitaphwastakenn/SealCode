#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { isSkillFile } from "../src/studioBridge/studioSkills.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { DEVELOPMENT_ICON_OVERRIDES } from "../../../scripts/lib/brand-assets.ts";
import { StudioPluginBundle } from "../src/studioBridge/StudioPluginInstaller.ts";
import { StudioSkillBundle } from "../src/studioBridge/studioSkills.ts";
import {
  ServerCliCommandExitError,
  ServerCliDevelopmentIconSourceMissingError,
  ServerCliDevelopmentIconTargetMissingError,
} from "./cliErrors.ts";

const encodeStudioPluginBundle = Schema.encodeEffect(StudioPluginBundle);
const encodeStudioSkillBundle = Schema.encodeEffect(StudioSkillBundle);

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../../..", import.meta.url))),
);

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.StandardCommand) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new ServerCliCommandExitError({
      command: command.command,
      args: command.args,
      cwd: command.options.cwd,
      exitCode,
    });
  }
});

const applyDevelopmentIconOverrides = Effect.fn("applyDevelopmentIconOverrides")(function* (
  repoRoot: string,
  serverDir: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  for (const override of DEVELOPMENT_ICON_OVERRIDES) {
    const sourcePath = path.join(repoRoot, override.sourceRelativePath);
    const targetPath = path.join(serverDir, override.targetRelativePath);

    if (!(yield* fs.exists(sourcePath))) {
      return yield* new ServerCliDevelopmentIconSourceMissingError({ sourcePath });
    }
    if (!(yield* fs.exists(targetPath))) {
      return yield* new ServerCliDevelopmentIconTargetMissingError({ targetPath });
    }

    yield* fs.copyFile(sourcePath, targetPath);
  }

  yield* Effect.log("[cli] Applied development icon overrides to dist/client");
});

const buildCmd = Command.make(
  "build",
  {
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");

      yield* Effect.log("[cli] Running tsdown...");
      yield* runCommand(
        ChildProcess.make(process.execPath, ["--run", "build:bundle"], {
          cwd: serverDir,
          stdout: config.verbose ? "inherit" : "ignore",
          stderr: "inherit",
          shell: false,
        }),
      );

      const webDist = path.join(repoRoot, "apps/web/dist");
      const clientTarget = path.join(serverDir, "dist/client");

      if (yield* fs.exists(webDist)) {
        yield* fs.copy(webDist, clientTarget);
        yield* applyDevelopmentIconOverrides(repoRoot, serverDir);
        yield* Effect.log("[cli] Bundled web app into dist/client");
      } else {
        yield* Effect.logWarning("[cli] Web dist not found. Skipping client bundle.");
      }

      // Harp's Studio plugin travels as one JSON file; the installer builds the model from it.
      const studioPluginDir = path.join(serverDir, "resources/studio-plugin");
      const studioPluginSources = [];
      for (const entry of (yield* fs.readDirectory(studioPluginDir, {
        recursive: true,
      })).toSorted()) {
        if (!entry.endsWith(".luau")) continue;
        studioPluginSources.push({
          path: entry.split(path.sep).join("/"),
          source: yield* fs.readFileString(path.join(studioPluginDir, entry)),
        });
      }
      yield* fs.writeFileString(
        path.join(serverDir, "dist/studio-plugin.json"),
        yield* encodeStudioPluginBundle(studioPluginSources),
      );
      yield* Effect.log(
        `[cli] Bundled the Studio plugin (${String(studioPluginSources.length)} modules) into dist/studio-plugin.json`,
      );

      // The Roblox skill pack, also as one JSON file.
      const studioSkillsDir = path.join(serverDir, "resources/studio-skills");
      const studioSkillFiles = [];
      for (const entry of (yield* fs.readDirectory(studioSkillsDir, {
        recursive: true,
      })).toSorted()) {
        if (!isSkillFile(entry)) continue;
        studioSkillFiles.push({
          path: entry.split(path.sep).join("/"),
          text: yield* fs.readFileString(path.join(studioSkillsDir, entry)),
        });
      }
      yield* fs.writeFileString(
        path.join(serverDir, "dist/studio-skills.json"),
        yield* encodeStudioSkillBundle(studioSkillFiles),
      );
      yield* fs.copyFile(
        path.join(studioSkillsDir, "ROBLOX-BRAIN-LICENSE.txt"),
        path.join(serverDir, "dist/ROBLOX-BRAIN-LICENSE.txt"),
      );
    }),
).pipe(Command.withDescription("Build the server package (tsdown + bundle web client)."));

const cli = Command.make("cli").pipe(
  Command.withDescription("Harp server build CLI."),
  Command.withSubcommands([buildCmd]),
);

Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
  NodeRuntime.runMain,
);
