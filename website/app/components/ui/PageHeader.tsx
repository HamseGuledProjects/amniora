import type { ReactNode } from "react";
import { cn } from "./utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-space-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="type-label mb-space-2 text-primary">{eyebrow}</p>
        )}
        <h1 className="type-page-title break-words text-text">{title}</h1>
        {description && (
          <p className="type-body mt-space-2 max-w-2xl text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-space-2 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
