import { cn } from "../lib/utils.js";

const VARIANTS = {
  primary: "bg-accent text-white hover:opacity-90",
  outline: "border border-border-strong text-text-1 hover:bg-panel",
  ghost: "text-text-2 hover:bg-panel",
};

export function Button({ variant = "primary", className, ...rest }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold font-mono cursor-pointer transition-colors",
        VARIANTS[variant], className
      )}
      {...rest}
    />
  );
}
