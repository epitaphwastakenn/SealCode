import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/snap-shot")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general", hash: "snap-shot", replace: true });
  },
});
