import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

export type FieldState = "default" | "error" | "success";
export type FieldDensity = "standard" | "compact";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  fieldState?: FieldState;
  density?: FieldDensity;
};

const states: Record<FieldState, string> = {
  default: "border-border-strong focus:border-primary focus:ring-focus",
  error: "border-error focus:border-error focus:ring-error",
  success: "border-success focus:border-success focus:ring-success",
};

export const fieldDensityClasses: Record<FieldDensity, string> = {
  standard: "h-11 px-3 sm:h-[42px]",
  compact: "h-10 px-2.5 sm:h-9",
};

export const inputBaseClasses =
  "type-body w-full min-w-0 rounded-ui-sm border bg-surface text-base text-text shadow-surface outline-none transition-[border-color,box-shadow] placeholder:text-text-muted focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:shadow-none sm:text-sm";

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
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
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? (fieldState === "error" || undefined)}
      data-density={density}
      className={cn(
        inputBaseClasses,
        fieldDensityClasses[density],
        states[fieldState],
        className
      )}
      {...props}
    />
  );
});

export default Input;
