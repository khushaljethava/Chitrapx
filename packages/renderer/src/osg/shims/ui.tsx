import type React from "react";

// Only reachable from editor upload affordances, which static rendering never shows.
export const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
  const { variant: _v, size: _s, ...rest } = props;
  return <button {...rest} />;
};
export const Input = (props: React.ComponentProps<"input">) => <input {...props} />;
