import type { HTMLAttributes } from "react";
import { cn } from "./utils";

type BadgeVariant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "verified"
  | "needsReview"
  | "blocked"
  | "beta"
  | "evidenceLog"
  | "evidenceConfig"
  | "evidencePolicy"
  | "evidenceData";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variants: Record<BadgeVariant, string> = {
  neutral: "bg-surface-muted text-text-secondary ring-border",
  primary: "bg-primary-subtle text-primary ring-blue-200",
  success: "bg-success-subtle text-success ring-emerald-200",
  warning: "bg-warning-subtle text-warning ring-amber-200",
  error: "bg-error-subtle text-error ring-red-200",
  verified: "bg-verified-subtle text-verified ring-emerald-200",
  needsReview: "bg-needs-review-subtle text-needs-review ring-amber-200",
  blocked: "bg-blocked-subtle text-blocked ring-rose-200",
  beta: "bg-private-beta-subtle text-private-beta ring-indigo-200",
  evidenceLog: "bg-evidence-log-subtle text-evidence-log ring-teal-200",
  evidenceConfig: "bg-evidence-config-subtle text-evidence-config ring-violet-200",
  evidencePolicy: "bg-evidence-policy-subtle text-evidence-policy ring-amber-200",
  evidenceData: "bg-evidence-data-subtle text-evidence-data ring-sky-200",
};

export default function Badge({
  className,
  variant = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "type-caption inline-flex min-h-5 items-center rounded-ui-pill px-2 py-0.5 font-medium ring-1 ring-inset",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
