import type { ImgHTMLAttributes } from "react";

export function SealCodeMark(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  return <img alt="" draggable={false} {...props} src="/sealcode-icon.png" />;
}
