import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { McpToolVisibility } from "../mcp/McpToolVisibility.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { RobloxStudioConfig } from "./RobloxStudioConfig.ts";

/** Hides the Roblox servers from threads outside Roblox projects, by the thread's project root. */
export const layer = Layer.effect(
  McpToolVisibility,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const roblox = yield* RobloxStudioConfig;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    return {
      hiddenServers: (thread) =>
        Effect.gen(function* () {
          const current = yield* settings.getSettings;
          const shell = yield* threads.getThreadShell(thread.threadId);
          const project =
            shell === null
              ? undefined
              : Option.getOrUndefined(yield* projects.getById(shell.projectId));
          return yield* roblox.hiddenServerIds(current, project?.workspaceRoot);
        }).pipe(Effect.orElseSucceed((): ReadonlySet<string> => new Set())),
    };
  }),
);
