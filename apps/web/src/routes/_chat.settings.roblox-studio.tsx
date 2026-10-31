import { createFileRoute } from "@tanstack/react-router";

import { RobloxStudioSettingsPanel } from "../components/settings/RobloxStudioSettings";

export const Route = createFileRoute("/_chat/settings/roblox-studio")({
  component: RobloxStudioSettingsPanel,
});
