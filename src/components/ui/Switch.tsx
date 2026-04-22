"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, disabled, id, className, ...aria },
  ref,
) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-primary" : "bg-white/10 border border-border",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow-md transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
});
