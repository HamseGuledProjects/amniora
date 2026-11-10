import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  leadingIcon?: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "ui-action-primary",
  secondary:
    "ui-action-secondary",
  outline:
    "ui-action-secondary bg-transparent",
  ghost:
    "border-transparent bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text",
  destructive:
    "border-error bg-error text-white hover:border-red-700 hover:bg-red-700",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-11 px-3 sm:h-8",
  md: "h-11 px-4 sm:h-10",
  lg: "h-11 px-5",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    leadingIcon,
    disabled,
    type = "button",
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "ui-action shrink-0",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      ) : (
        leadingIcon
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});

export default Button;
