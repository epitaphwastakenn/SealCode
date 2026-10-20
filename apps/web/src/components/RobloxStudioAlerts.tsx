import type { EnvironmentId, RobloxStudioAlert } from "@t3tools/contracts";
import { CircleAlertIcon, UnplugIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { hasDesktopNotifications } from "../threadNotifications";
import { toastManager } from "./ui/toast";

const alertTitle = (alert: RobloxStudioAlert) =>
  alert.kind === "disconnected"
    ? `Roblox Studio disconnected: ${alert.placeName}`
    : `Playtest error in ${alert.placeName}${alert.count > 1 ? ` (${String(alert.count)} errors)` : ""}`;

/** Tells the user when a SealCode-linked Studio goes away or a playtest errors. */
function EnvironmentStudioAlerts({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const alerts = useEnvironmentQuery(
    serverEnvironment.robloxStudioAlerts({ environmentId, input: {} }),
  );
  const lastShown = useRef<number | undefined>(undefined);
  const alert = alerts.data ?? undefined;

  useEffect(() => {
    if (alert === undefined || lastShown.current === alert.at) return;
    lastShown.current = alert.at;
    const title = alertTitle(alert);
    const focused = document.visibilityState === "visible" && document.hasFocus();
    if (focused) {
      if (!inApp) return;
      toastManager.add({
        type: alert.kind === "disconnected" ? "warning" : "error",
        title,
        description: alert.message,
        data: {
          hideCopyButton: alert.kind === "disconnected",
          leadingIcon:
            alert.kind === "disconnected" ? (
              <UnplugIcon aria-hidden className="size-4 text-warning-foreground" />
            ) : (
              <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
            ),
        },
      });
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    try {
      const notification = new Notification(title, {
        body: alert.message,
        tag: `roblox-studio:${environmentId}:${alert.instanceId}:${alert.kind}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  }, [alert, environmentId, inApp, mode]);

  return null;
}

export function RobloxStudioAlerts() {
  const environmentIds = useEnvironmentIds();
  return environmentIds.map((environmentId) => (
    <EnvironmentStudioAlerts key={environmentId} environmentId={environmentId} />
  ));
}
