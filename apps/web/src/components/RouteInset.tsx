import { useRef, type ComponentProps } from "react";

import { useEnterMotion } from "../panelAnimations";
import { SidebarInset } from "./ui/sidebar";

/**
 * The main column of a route. It settles in when a navigation mounts it; opacity
 * only, because floating panels clip the backdrop to its measured rect and the
 * chat column places native browser views from rects inside it.
 */
export function RouteInset(props: Omit<ComponentProps<typeof SidebarInset>, "ref">) {
  const insetRef = useRef<HTMLElement | null>(null);
  useEnterMotion(insetRef, "route", "settle", { onMount: "navigation" });
  return <SidebarInset ref={insetRef} {...props} />;
}
