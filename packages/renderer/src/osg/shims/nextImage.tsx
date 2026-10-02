import type React from "react";

type Props = React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean; onLoadingComplete?: () => void };
/** next/image stand-in: a plain <img>, filling its box when `fill` is set. */
export default function Image({ fill, unoptimized: _u, priority: _p, onLoadingComplete, style, ...rest }: Props) {
  return <img {...rest} onLoad={onLoadingComplete} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style} />;
}
