import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderSetupInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  action: Schema.Literals(["status", "install", "login", "cancel", "logout", "callback"]),
  callbackUrl: Schema.optionalKey(Schema.String),
});
export type ProviderSetupInput = typeof ProviderSetupInput.Type;
export const ProviderSetupState = Schema.Struct({
  phase: Schema.Literals(["idle", "installing", "signing-in", "ready", "error"]),
  authorizationUrl: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type ProviderSetupState = typeof ProviderSetupState.Type;
export class ProviderSetupError extends Schema.TaggedErrorClass<ProviderSetupError>()(
  "ProviderSetupError",
  {
    message: Schema.String,
  },
) {}
