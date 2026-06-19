import { forwardRef } from "react";
import { cn } from "../lib/utils.js";

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-1 outline-none focus:border-accent placeholder:text-text-3 font-mono",
        className
      )}
      {...rest}
    />
  );
});
