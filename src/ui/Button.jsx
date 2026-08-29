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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 font-sans text-sm font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant], className
      )}
      {...rest}
    />
  );
}
