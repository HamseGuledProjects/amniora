import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { BookOpen, Bot, FileSearch, GraduationCap, Map, ShieldCheck } from "lucide-react";
import { ProductCTA, ProductHero, ProductPageShell, ProductSection } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "About Amniora",
  description:
    "Explore the investigation model behind Amniora, a cancelled cybersecurity learning project preserved as a local portfolio demo.",
  path: "/about",
});

const claimBoundaries = [
  ["Observed evidence", "A log line, file entry or document statement that appears in the supplied case."],
  ["Supported inference", "A conclusion that follows from listed evidence and names its limits."],
  ["Unsupported claim", "A statement about intent, scope or compromise that the evidence does not prove."],
] as const;

const principles = [
  ["Concrete practice", "Learners need evidence, constraints and an objective before a cybersecurity concept becomes useful practice."],
  ["Useful guidance", "AI can help explain the next step, but the learner still has to inspect the evidence and make the finding."],
  ["Visible uncertainty", "Good investigation work includes saying what the evidence cannot prove."],
  ["Traceable progress", "Saved labs, roadmap status and achievements make practical development visible over time."],
] as const;

const platformLedger = [
  [FileSearch, "Generated investigations", "Structured cases with learner-visible synthetic evidence and task requirements.", "Investigations"],
  [GraduationCap, "Linux labs", "The implemented investigation engine focuses on Linux system evidence and analysis.", "Practice"],
  [Bot, "AI Tutor", "Focused learning support for questions and task-level guidance.", "Support"],
  [Map, "Roadmap", "An organised progression view with sample learning states.", "Progress"],
  [ShieldCheck, "Safe practice", "The local demo uses synthetic, non-sensitive information.", "Safety"],
  [BookOpen, "Saved work", "Investigations can be revisited as part of continued learning.", "Review"],
] as const;

export default function AboutPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="About Amniora"
        title="Learn to explain what the evidence can and cannot prove."
        description="Amniora was built around synthetic case material, structured tasks and careful cybersecurity reasoning. The project is cancelled; this local demo preserves its interface and source."
        secondaryLabel="Explore labs"
        secondaryHref="/labs"
      />

      <section className="bg-paper">
        <div className="layout-workspace grid gap-space-8 py-10 sm:py-12 lg:grid-cols-[0.42fr_1fr] lg:py-14">
          <div>
            <p className="type-label font-semibold uppercase text-primary">Careful reasoning</p>
            <h2 className="mt-space-2 text-3xl font-semibold leading-tight text-heading sm:text-4xl">Keep facts, conclusions and unknowns separate.</h2>
            <p className="mt-space-4 text-base leading-7 text-text-secondary">Learners practise keeping three ideas separate instead of blending them into a confident but unsupported answer.</p>
          </div>
          <div className="grid gap-space-4">
            {claimBoundaries.map(([label, text], index) => (
              <article key={label} className="grid gap-space-3 border-t border-border-strong pt-space-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                <span className="font-mono text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-xl font-semibold text-heading">{label}</h3>
                  <p className="mt-space-2 text-sm leading-6 text-text-secondary">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ProductSection
        muted
        eyebrow="Principles"
        title="Learning starts with practical investigation work"
        description="Learners practise reading artefacts, forming supported conclusions and naming uncertainty."
      >
        <div className="columns-1 gap-space-8 md:columns-2">
          {principles.map(([title, text]) => (
            <article key={title} className="mb-space-6 break-inside-avoid border-l border-border-strong pl-space-4">
              <h3 className="type-card-title text-heading">{title}</h3>
              <p className="mt-space-2 type-body text-text-secondary">{text}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        eyebrow="Project design"
        title="What Amniora brought together"
        description="The original design combined generated labs, AI guidance and learning progress. This demo shows fixed sample cases and responses without a real account."
      >
        <div className="border-y border-border bg-white">
          {platformLedger.map(([Icon, title, text, role], index) => (
            <article key={title} className="grid gap-space-3 border-b border-border-subtle px-space-4 py-space-4 last:border-b-0 md:grid-cols-[2rem_2.5rem_minmax(0,0.85fr)_minmax(0,1.45fr)_7rem] md:items-start">
              <Icon size={18} className="text-primary" aria-hidden="true" />
              <span className="font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="min-w-0 text-sm font-semibold leading-6 text-heading">{title}</h3>
              <p className="min-w-0 text-sm leading-6 text-text-secondary">{text}</p>
              <p className="min-w-0 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-text-muted md:text-right">{role}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        muted
        eyebrow="Current status"
        title="A cancelled project, preserved for review"
        description="Development has ended. There is no current beta, signup, payment plan or promised release. The local demo is a portfolio walkthrough."
      >
        <p className="max-w-3xl border-l border-primary pl-space-5 text-base leading-7 text-text-secondary">Read the evidence, write your findings and explain what remains uncertain.</p>
      </ProductSection>

      <ProductCTA
        title="See the investigation model in action."
        description="Explore the original investigation structure using synthetic local examples."
        secondaryHref="/features"
        secondaryLabel="View features"
      />
    </ProductPageShell>
  );
}
