import type { ComponentProps } from "react";

import { Button } from "../ui/button";

export function ComposerSendButton(props: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return <Button variant="send" size="icon-sm" {...props} />;
}
