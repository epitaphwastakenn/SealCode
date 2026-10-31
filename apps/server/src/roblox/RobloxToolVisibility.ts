import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { isStudioRestricted } from "@t3tools/shared/studioControls";

import { McpCallPolicy } from "../mcp/McpCallPolicy.ts";
import { McpToolVisibility } from "../mcp/McpToolVisibility.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { policyFromControls, studioControlsMetaKey } from "../studioBridge/studioControls.ts";
import {
  OFFICIAL_SERVER_ID,
  RobloxStudioConfig,
  STUDIO_BRIDGE_SERVER_ID,
} from "./RobloxStudioConfig.ts";

/** Hides the Roblox servers from threads outside Roblox projects, by the thread's project root. */
const visibilityLayer = Layer.effect(
  McpToolVisibility,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const roblox = yield* RobloxStudioConfig;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const noneHidden = Effect.orElseSucceed((): ReadonlySet<string> => new Set());
    return {
      hiddenServers: Effect.fn("RobloxToolVisibility.hiddenServers")(function* (thread) {
        const current = yield* settings.getSettings;
        const shell = yield* threads.getThreadShell(thread.threadId);
        const project =
          shell === null
            ? undefined
            : Option.getOrUndefined(yield* projects.getById(shell.projectId));
        const hidden = yield* roblox.hiddenServerIds(current, project?.workspaceRoot);
        return isStudioRestricted(shell?.studioControls) &&
          current.mcpServers[OFFICIAL_SERVER_ID] === undefined
          ? new Set([...hidden, OFFICIAL_SERVER_ID])
          : hidden;
      }, noneHidden),
      hiddenServersForProject: Effect.fn("RobloxToolVisibility.hiddenServersForProject")(function* (
        projectId,
      ) {
        const current = yield* settings.getSettings;
        const project = Option.getOrUndefined(yield* projects.getById(projectId));
        return yield* roblox.hiddenServerIds(current, project?.workspaceRoot);
      }, noneHidden),
    };
  }),
);

const callPolicyLayer = Layer.effect(
  McpCallPolicy,
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    return {
      forCall: ({ thread, serverId }) =>
        serverId !== STUDIO_BRIDGE_SERVER_ID
          ? Effect.succeed({ _tag: "Allow" })
          : threads.getThreadShell(thread.threadId).pipe(
              Effect.map((shell) =>
                shell === null
                  ? ({
                      _tag: "Refuse",
                      message: "Harp could not find this thread, so the Studio call was refused.",
                    } as const)
                  : ({
                      _tag: "Allow",
                      meta: { [studioControlsMetaKey]: policyFromControls(shell.studioControls) },
                    } as const),
              ),
              Effect.orElseSucceed(
                () =>
                  ({
                    _tag: "Refuse",
                    message:
                      "Harp could not read this thread's Studio controls, so the Studio call was refused. Try again.",
                  }) as const,
              ),
            ),
    };
  }),
);

export const layer = Layer.merge(visibilityLayer, callPolicyLayer);
