import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";

type CardVariant = "default" | "hover" | "selected" | "disabled";
type CardDensity = "compact" | "standard" | "comfortable";
type CardSurface = "default" | "inset" | "elevated";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  density?: CardDensity;
  surface?: CardSurface;
};

const variants: Record<CardVariant, string> = {
  default: "border-border bg-surface shadow-surface",
  hover:
    "border-border bg-surface shadow-surface transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-hover motion-reduce:hover:translate-y-0",
  selected: "border-primary bg-primary-subtle shadow-surface",
  disabled:
    "cursor-not-allowed border-border bg-surface-muted opacity-60 shadow-none",
};

const densities: Record<CardDensity, string> = {
  compact: "p-space-3",
  standard: "p-space-5",
  comfortable: "p-space-6",
};

const surfaces: Record<CardSurface, string> = {
  default: "",
  inset: "bg-surface-inset shadow-none",
  elevated: "bg-surface-elevated shadow-surface",
};

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className,
    variant = "default",
    density = "standard",
    surface = "default",
    ...props
  },
  ref
) {
  return (
    <div
      ref={ref}
      data-density={density}
      className={cn(
        "min-w-0 max-w-full rounded-ui-md border text-text",
        variants[variant],
        densities[density],
        surfaces[surface],
        className
      )}
      {...props}
    />
  );
});

export default Card;
