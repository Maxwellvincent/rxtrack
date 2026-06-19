import { cn } from "../lib/utils.js";

export function Card({ className, ...rest }) {
  return <div className={cn("rounded-xl bg-panel p-4", className)} {...rest} />;
}

export function Panel({ className, ...rest }) {
  return <div className={cn("rounded-lg border border-border bg-bg-elevated p-3", className)} {...rest} />;
}
