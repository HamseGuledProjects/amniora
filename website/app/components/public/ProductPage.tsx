import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Reveal } from "../LandingMotion";
import PublicFooter from "../PublicFooter";
import PublicNavbar from "../PublicNavbar";

export function ProductPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-text">
      <PublicNavbar />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}

export function ProductHero({
  eyebrow,
  title,
  description,
  primaryLabel = "Explore local demo",
  primaryHref = "/dashboard",
  secondaryLabel,
  secondaryHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  return (
    <header className="border-b border-border-subtle bg-paper">
      <Reveal viewportReveal={false} className="layout-workspace grid gap-space-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,0.78fr)_minmax(280px,0.42fr)] lg:items-end lg:py-20">
        <div>
          <p className="type-label font-semibold uppercase text-primary">{eyebrow}</p>
          <h1 className="mt-space-3 max-w-4xl text-4xl font-semibold leading-[1.06] text-heading sm:text-5xl lg:text-6xl">{title}</h1>
        </div>
        <div className="border-l border-border-strong pl-space-4 lg:pl-space-5">
          <p className="max-w-xl text-base leading-7 text-text-secondary sm:text-lg">{description}</p>
          <div className="mt-space-6 flex flex-col gap-space-2 sm:flex-row lg:flex-col xl:flex-row">
            <Link href={primaryHref} className="ui-action ui-action-primary ui-action-arrow">
              {primaryLabel}<ArrowRight size={16} aria-hidden="true" />
            </Link>
            {secondaryLabel && secondaryHref && (
              <Link href={secondaryHref} className="ui-action ui-action-secondary">
                {secondaryLabel}
              </Link>
            )}
          </div>
        </div>
      </Reveal>
    </header>
  );
}

export function ProductSection({
  eyebrow,
  title,
  description,
  children,
  muted = false,
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  muted?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`${muted ? "border-y border-border-subtle bg-paper-muted" : "bg-paper"} anchor-target`}>
      <div className="layout-workspace public-section-tight">
        <Reveal className="grid gap-space-4 md:grid-cols-[0.42fr_1fr] md:items-start">
          <div>
            {eyebrow && <p className="type-label font-semibold uppercase text-primary">{eyebrow}</p>}
            <h2 className="mt-space-2 max-w-2xl text-3xl font-semibold leading-tight text-heading sm:text-4xl">{title}</h2>
          </div>
          {description && <p className="max-w-2xl text-base leading-7 text-text-secondary md:pt-space-8">{description}</p>}
        </Reveal>
        <div className="mt-space-8">{children}</div>
      </div>
    </section>
  );
}

export type ProductFeature = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function ProductFeatureGrid({ features, columns = 3 }: { features: ProductFeature[]; columns?: 2 | 3 | 4 }) {
  const columnClass = columns === 4 ? "lg:grid-cols-4" : columns === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid gap-x-space-8 gap-y-space-6 ${columnClass}`}>
      {features.map(({ title, description, icon: Icon }, index) => (
        <Reveal key={title} delay={index * 0.025} className="h-full">
          <article className="h-full border-t border-border-strong pt-space-4">
            <div className="flex items-center gap-space-2">
              <Icon size={17} className="text-primary" aria-hidden="true" />
              <h3 className="type-card-title text-heading">{title}</h3>
            </div>
            <p className="mt-space-2 type-body text-text-secondary">{description}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

export function ProductChecklist({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-space-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-space-3 border-t border-border-subtle pt-space-3 text-sm leading-6 text-text-secondary">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProductCTA({ title, description, secondaryHref, secondaryLabel }: { title: string; description: string; secondaryHref?: string; secondaryLabel?: string }) {
  return (
    <section className="border-t border-border-subtle bg-review px-4 py-14 sm:px-6 lg:px-8">
      <Reveal className="mx-auto grid max-w-6xl gap-space-7 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h2 className="text-2xl font-semibold leading-tight text-heading sm:text-3xl">{title}</h2>
          <p className="mt-space-2 max-w-2xl text-base leading-7 text-text-secondary">{description}</p>
        </div>
        <div className="flex flex-col gap-space-2 sm:flex-row">
          <Link href="/dashboard" className="ui-action ui-action-primary">Explore local demo</Link>
          {secondaryHref && secondaryLabel && <Link href={secondaryHref} className="ui-action ui-action-secondary">{secondaryLabel}</Link>}
        </div>
      </Reveal>
    </section>
  );
}

export function ProductEvidenceTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div>
      <p className="sr-only">{caption}</p>
      <div className="grid gap-space-3 sm:hidden">
        {rows.map((row) => (
          <article key={row.join("|")} className="border-t border-border-strong pt-space-3">
            <h3 className="text-sm font-semibold text-heading">{row[0]}</h3>
            <dl className="mt-space-2 grid gap-space-2">
              {row.slice(1).map((cell, index) => (
                <div key={`${columns[index + 1]}-${cell}`} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-space-2 text-sm leading-5">
                  <dt className="text-xs font-semibold uppercase text-text-muted">{columns[index + 1]}</dt>
                  <dd className="min-w-0 break-words text-text-secondary">{cell}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto border-y border-border bg-white sm:block">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-paper-muted">
              {columns.map((column) => (
                <th key={column} scope="col" className="px-space-4 py-space-3 font-semibold text-heading">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join("|")} className="border-b border-border-subtle last:border-b-0">
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={cell} scope="row" className="px-space-4 py-space-3 font-medium text-heading">
                      {cell}
                    </th>
                  ) : (
                    <td key={cell} className="px-space-4 py-space-3 text-text-secondary">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProductNumberedList({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="grid gap-space-5 md:grid-cols-2">
      {items.map((item, index) => (
        <li key={item.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-space-3 border-t border-border-strong pt-space-4">
          <span className="font-mono text-xs font-semibold text-primary">0{index + 1}</span>
          <span>
            <h3 className="type-card-title text-heading">{item.title}</h3>
            <p className="mt-space-2 type-body text-text-secondary">{item.text}</p>
          </span>
        </li>
      ))}
    </ol>
  );
}