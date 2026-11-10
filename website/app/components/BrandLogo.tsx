import Image from "next/image";
import { BRAND } from "../../lib/brand";

type BrandLogoProps = {
  variant?: "full" | "icon" | "wordmark";
  theme?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes = {
  sm: { icon: "h-6 w-6", text: "text-xl", gap: "gap-2" },
  md: { icon: "h-7 w-7", text: "text-2xl", gap: "gap-2.5" },
  lg: { icon: "h-10 w-10", text: "text-3xl", gap: "gap-3" },
} as const;

export default function BrandLogo({
  variant = "full",
  theme = "dark",
  size = "md",
  className = "",
}: BrandLogoProps) {
  const styles = sizes[size];
  const foreground = theme === "dark" ? "text-white" : "text-slate-950";
  const iconSrc =
    theme === "dark"
      ? "/brand/amniora-icon-white-cropped.png"
      : "/brand/amniora-icon-navy-cropped.png";

  return (
    <span
      data-brand-logo={theme}
      data-brand-variant={variant}
      className={`inline-flex min-w-0 items-center ${styles.gap} ${foreground} ${className}`}
      aria-label={variant === "icon" ? BRAND.name : undefined}
    >
      {variant !== "wordmark" && (
        <span
          aria-hidden="true"
          data-brand-logo-symbol="true"
          className={`inline-flex shrink-0 items-center justify-center ${styles.icon}`}
        >
          <Image
            src={iconSrc}
            alt=""
            width={383}
            height={414}
            className="h-full w-full object-contain"
          />
        </span>
      )}
      {variant !== "icon" && (
        <span data-brand-logo-wordmark="true"
          className={`truncate font-bold tracking-tight ${styles.text}`}>
          {BRAND.name}
        </span>
      )}
    </span>
  );
}
