import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { CheckCircle2, Flag, Map, Target } from "lucide-react";
import { ProductCTA, ProductHero, ProductPageShell, ProductSection } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Historical Learning Roadmap",
  description:
    "Review the original Amniora learning progression design. The project is cancelled and this is not a release roadmap.",
  path: "/roadmap",
});

const stages = [
  ["Linux fundamentals", "Completed", "Core system context", "Evidence orientation"],
  ["Log analysis", "Current", "Evidence reading and correlation", "Finding practice"],
  ["Network analysis", "Unreleased", "Unfinished learning area", "Traffic and exposure"],
  ["Incident response", "Unreleased", "Unfinished learning area", "Containment and review"],
] as const;

const statusModel = [
  ["Sample states", "Completed and current labels illustrate a fictional learner progression."],
  ["Unreleased", "The original design included topics that were not completed before cancellation."],
  ["Project ended", "No further releases or investigation environments are promised."],
] as const;

const notes = [
  ["Ordered learning", "The original design arranged topics into an ordered learning sequence."],
  ["Practice connection", "Roadmap topics point learners toward hands-on investigations and saved progress."],
  ["Completion visibility", "Completed modules and saved labs help learners track what they have practised."],
] as const;

function statusClass(status: string) {
  if (status === "Completed") return "border-success bg-success-subtle text-success";
  if (status === "Current") return "border-primary bg-primary-subtle text-primary";
  return "border-border bg-surface-muted text-text-muted";
}

export default function RoadmapMarketingPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="Structured progression"
        title="Explore the original learning progression design."
        description="Amniora is cancelled. This historical example preserves the learning roadmap interface and sample progress states; it is not a development commitment."
        secondaryLabel="Explore investigations"
        secondaryHref="/labs"
      />

      <section className="bg-paper">
        <div className="layout-workspace grid gap-space-8 py-10 sm:py-12 lg:grid-cols-[0.36fr_1fr] lg:py-14">
          <div>
            <p className="type-label font-semibold uppercase text-primary">Historical roadmap example</p>
            <h2 className="mt-space-2 text-3xl font-semibold leading-tight text-heading sm:text-4xl">Follow a clear sequence of learning areas.</h2>
            <p className="mt-space-4 text-base leading-7 text-text-secondary">Completed and current labels describe a fictional learner. Unreleased areas record unfinished parts of the original design.</p>
          </div>
          <ol role="img" aria-label="Historical Amniora learning roadmap with fictional progress and unreleased modules" className="relative grid gap-space-3">
            <span className="absolute bottom-8 left-4 top-8 hidden w-px bg-border-strong sm:block" aria-hidden="true" />
            {stages.map(([title, status, note, practice], index) => (
              <li key={title} className="relative grid gap-space-3 border-y border-border bg-white px-space-4 py-space-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center">
                <span className={`z-10 flex h-8 w-8 items-center justify-center rounded-ui-sm border text-sm font-semibold ${statusClass(status)}`}>
                  {status === "Completed" ? <CheckCircle2 size={16} /> : status === "Current" ? <Flag size={15} /> : index + 1}
                </span>
                <span>
                  <span className="block text-base font-semibold text-heading">{title}</span>
                  <span className="block text-sm leading-6 text-text-secondary">{note}</span>
                </span>
                <span className="grid gap-1 text-left sm:text-right">
                  <span className="text-xs font-semibold uppercase text-text-muted">{status}</span>
                  <span className="text-xs text-text-muted">{practice}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ProductSection
        muted
        eyebrow="Reading this example"
        title="Separate sample progress from project status"
        description="The interface demonstrates learning progression. It does not announce product availability."
      >
        <div className="grid gap-space-3 md:grid-cols-3">
          {statusModel.map(([label, text]) => (
            <article key={label} className="border-t border-border-strong pt-space-4">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-primary">{label}</p>
              <p className="mt-space-3 text-sm leading-6 text-text-secondary">{text}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        eyebrow="Practice connection"
        title="Progress connects back to investigations"
        description="Roadmap topics connect to labs, saved progress and the next skills learners can practise."
      >
        <div className="grid gap-space-5 md:grid-cols-3">
          {notes.map(([title, text]) => (
            <article key={title} className="border-l border-border-strong pl-space-4">
              <Target size={18} className="text-primary" aria-hidden="true" />
              <h3 className="mt-space-3 type-card-title text-heading">{title}</h3>
              <p className="mt-space-2 type-body text-text-secondary">{text}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        muted
        eyebrow="Unfinished work"
        title="Some planned areas remained unfinished"
        description="These areas were part of the original concept when development ended."
      >
        <p className="flex max-w-3xl gap-space-3 border-l border-primary pl-space-5 text-sm leading-6 text-text-secondary">
          <Map size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          Additional investigation environments and response scenarios were considered, but they are not promised as future releases.
        </p>
      </ProductSection>

      <ProductCTA
        title="Turn practice into visible progress."
        description="Explore fictional learning progress and synthetic investigations in the local demo."
        secondaryHref="/features"
        secondaryLabel="View features"
      />
    </ProductPageShell>
  );
}
