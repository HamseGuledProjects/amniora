import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./utils";
import { type FieldDensity, type FieldState } from "./Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  fieldState?: FieldState;
  density?: FieldDensity;
};

const states: Record<FieldState, string> = {
  default: "border-border-strong focus:border-primary focus:ring-focus",
  error: "border-error focus:border-error focus:ring-error",
  success: "border-success focus:border-success focus:ring-success",
};

const densities: Record<FieldDensity, string> = {
  standard: "min-h-28 px-3 py-2.5",
  compact: "min-h-20 px-2.5 py-2",
};

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
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
      <textarea
        ref={ref}
        aria-invalid={ariaInvalid ?? (fieldState === "error" || undefined)}
        data-density={density}
        className={cn(
          "type-body w-full min-w-0 resize-y rounded-ui-sm border bg-surface text-base text-text shadow-surface outline-none transition-[border-color,box-shadow] placeholder:text-text-muted focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:shadow-none sm:text-sm",
          densities[density],
          states[fieldState],
          className
        )}
        {...props}
      />
    );
  }
);

export default Textarea;
