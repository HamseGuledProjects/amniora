import Link from "next/link";
import { FileText } from "lucide-react";
import { Reveal } from "../LandingMotion";
import PublicFooter from "../PublicFooter";
import PublicNavbar from "../PublicNavbar";

export type PublicContentSection = {
  title: string;
  content: string;
};

function sectionId(title: string) {
  return title
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function sectionNumber(title: string, index: number) {
  const match = title.match(/^(\d+)\./);
  return match ? match[1].padStart(2, "0") : String(index + 1).padStart(2, "0");
}

export default function PublicContentPage({
  category,
  title,
  description,
  lastUpdated,
  sections,
  note,
}: {
  category: string;
  title: string;
  description: string;
  lastUpdated?: string;
  sections: PublicContentSection[];
  note?: string;
}) {
  return (
    <div className="legal-shell min-h-screen overflow-x-clip text-text">
      <PublicNavbar />
      <main>
        <header className="border-b border-investigation-line bg-investigation text-white">
          <Reveal viewportReveal={false} className="layout-workspace grid gap-space-8 py-10 sm:py-14 lg:grid-cols-[0.34fr_1fr] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue-100/70">{category}</p>
              <h1 className="mt-space-3 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl">{title}</h1>
            </div>
            <div className="border-l border-blue-100/22 pl-space-4">
              <p className="max-w-2xl text-base leading-7 text-blue-50/78">{description}</p>
              {lastUpdated && <p className="mt-space-4 font-mono text-xs uppercase tracking-[0.12em] text-blue-100/66">Last updated / {lastUpdated}</p>}
            </div>
          </Reveal>
        </header>

        <div className="layout-workspace grid items-start gap-space-8 py-10 sm:py-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav
            aria-label={`${title} contents`}
            className="legal-index lg:sticky lg:top-24"
          >
            <div className="px-space-4 py-space-4">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">On this page</p>
              <ol className="legal-index__list mt-space-3 grid gap-space-1 pb-space-1 sm:grid-cols-2 lg:block lg:max-h-none lg:space-y-space-1 lg:overflow-visible lg:pb-0">
                {sections.map((section, index) => (
                  <li key={section.title} className="min-w-0">
                    <Link
                      href={`#${sectionId(section.title)}`}
                      className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-space-2 border-l border-border-subtle px-space-2 py-space-2 text-xs leading-5 text-text-secondary outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-focus sm:grid-cols-[2rem_minmax(0,1fr)]"
                    >
                      <span className="font-mono text-primary">{sectionNumber(section.title, index)}</span>
                      <span className="break-words">{section.title.replace(/^\d+\.\s*/, "")}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <article className="min-w-0">
            {note && (
              <aside className="mb-space-8 flex gap-space-3 border-l border-warning bg-warning-subtle p-space-4 text-sm leading-6 text-text-secondary">
                <FileText size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <p>{note}</p>
              </aside>
            )}
            <div className="max-w-3xl">
              {sections.map((section, index) => (
                <section key={section.title} id={sectionId(section.title)} data-section-number={sectionNumber(section.title, index)} className="legal-section scroll-mt-24 border-t border-border-subtle first:border-t-0 first:pt-0">
                  <h2 className="text-2xl font-semibold leading-tight text-heading">{section.title.replace(/^\d+\.\s*/, "")}</h2>
                  <p className="mt-space-4 break-words text-[15px] leading-8 text-text-secondary">{section.content}</p>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}