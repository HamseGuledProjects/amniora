import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { sortedDevelopmentLogEntries } from "@/lib/developmentLog";
import { ProductPageShell } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Development Log",
  description:
    "Read archived Amniora product updates from before the project was cancelled.",
  path: "/development-log",
});

const entries = sortedDevelopmentLogEntries();

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function DevelopmentLogPage() {
  return (
    <ProductPageShell>
      <header className="border-b border-border-subtle bg-paper">
        <div className="layout-workspace grid gap-space-8 py-10 sm:py-14 lg:grid-cols-[0.34fr_1fr] lg:items-end">
          <div>
            <p className="type-label font-semibold uppercase text-primary">Archived product updates</p>
            <h1 className="mt-space-3 text-4xl font-semibold leading-tight text-heading sm:text-5xl">Development Log</h1>
          </div>
          <p className="max-w-2xl border-l border-border-strong pl-space-4 text-base leading-7 text-text-secondary">
            Amniora is cancelled. These dated entries preserve the original development history. References to beta access describe that period, not a current service.
          </p>
        </div>
      </header>

      <section aria-labelledby="development-log-releases" className="bg-paper-muted">
        <div className="layout-workspace py-10 sm:py-12 lg:py-14">
          <div className="grid gap-space-4 md:grid-cols-[0.34fr_1fr]">
            <div>
              <p className="type-label font-semibold uppercase text-primary">History</p>
              <h2 id="development-log-releases" className="mt-space-2 text-3xl font-semibold leading-tight text-heading">Archived public updates</h2>
            </div>
            {entries.length === 0 ? (
              <p className="border-y border-border bg-white px-space-4 py-space-5 text-sm leading-6 text-text-secondary">No archived development updates are available.</p>
            ) : (
              <ol className="border-y border-border bg-white">
                {entries.map((entry) => (
                  <li key={`${entry.date}-${entry.label}`} className="grid gap-space-4 border-b border-border-subtle px-space-4 py-space-5 last:border-b-0 md:grid-cols-[9rem_minmax(0,1fr)]">
                    <div>
                      <time dateTime={entry.date} className="font-mono text-xs font-semibold text-primary">{formatDate(entry.date)}</time>
                      <p className="mt-space-2 text-xs uppercase text-text-muted">{entry.categories.join(" / ")}</p>
                    </div>
                    <article>
                      <p className="type-label font-semibold text-text-muted">{entry.label}</p>
                      <h3 className="mt-space-1 text-xl font-semibold leading-tight text-heading">{entry.title}</h3>
                      <ul className="mt-space-4 grid gap-space-2 text-sm leading-6 text-text-secondary">
                        {entry.improvements.map((improvement) => (
                          <li key={improvement} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-space-2">
                            <span className="mt-2 h-px bg-primary" aria-hidden="true" />
                            <span>{improvement}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </ProductPageShell>
  );
}