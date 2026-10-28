import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc.ts";

// Synchronous and read from render paths; untraced like the other sync reads.
export const getLocalEnvironmentEnabled = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fnUntraced(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).localEnvironmentEnabled;
  }),
});

export const setLocalEnvironmentEnabled = makeIpcMethod({
  channel: IpcChannels.SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.localEnvironment.setEnabled")(function* (enabled) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const change = yield* appSettings.setLocalEnvironmentEnabled(enabled);
    if (change.changed) {
      yield* lifecycle.relaunch(`localEnvironmentEnabled=${enabled}`);
    }
  }),
});
