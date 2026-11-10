import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "./utils";
import {
  fieldDensityClasses,
  inputBaseClasses,
  type FieldDensity,
  type FieldState,
} from "./Input";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  fieldState?: FieldState;
  density?: FieldDensity;
};

const states: Record<FieldState, string> = {
  default: "border-border-strong focus:border-primary focus:ring-focus",
  error: "border-error focus:border-error focus:ring-error",
  success: "border-success focus:border-success focus:ring-success",
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className,
    fieldState = "default",
    density = "standard",
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={ariaInvalid ?? (fieldState === "error" || undefined)}
      data-density={density}
      className={cn(
        inputBaseClasses,
        fieldDensityClasses[density],
        "appearance-auto pr-8",
        states[fieldState],
        className
      )}
      {...props}
    />
  );
});

export default Select;
