import { defineProviderClient } from "@t3tools/provider-core/client";

import { COMMAND_CODE_ICON_DATA_URL } from "./icon.ts";
import { COMMAND_CODE_DRIVER_KIND } from "./identity.ts";
import { CommandCodeSettings } from "./settings.ts";

export const commandCodeClient = defineProviderClient({
  driverKind: COMMAND_CODE_DRIVER_KIND,
  label: "CommandCode",
  settingsSchema: CommandCodeSettings,
  icon: {
    viewBox: "0 0 128 128",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [],
    image: COMMAND_CODE_ICON_DATA_URL,
  },
});
