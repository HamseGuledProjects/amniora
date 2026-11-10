import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Brain, FileSearch, Gauge, Lightbulb, ListChecks, Terminal } from "lucide-react";
import { ProductCTA, ProductHero, ProductPageShell, ProductSection } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Cybersecurity Investigation Labs",
  description:
    "Explore synthetic investigation examples and the lab engine preserved from the cancelled Amniora project.",
  path: "/labs",
});

const caseIndex = [
  ["Incident brief", "Linux service disruption during a declared investigation window."],
  ["Evidence classes", "Authentication logs, service history, policy notes and exported artefacts."],
  ["Investigation task", "Only the evidence listed on each task should be used for that answer."],
  ["Learner output", "A finding, what the evidence cannot prove and evidence-supported next steps."],
  ["Review result", "Saved lab review, feedback and exportable PDF/evidence ZIP."],
] as const;

const evidenceBands = [
  ["Identity", "auth.log", "Who acted, and how confidently the evidence supports that actor."],
  ["Activity", "service and process history", "What changed over time, separated from current state."],
  ["Authority", "change request and ticket", "Whether the observed activity matches the approved time window."],
  ["Output", "PDF and evidence ZIP", "A stable learner-facing package for review."],
] as const;

const difficulty = [
  ["Beginner", "Focused evidence", "One clear output", "30 min"],
  ["Intermediate", "Correlation", "Evidence gaps and policy comparison", "30 min"],
  ["Advanced", "Multi-source analysis", "Uncertainty and remediation depth", "60 min"],
] as const;

const guidanceLedger = [
  [ListChecks, "Explain", "Clarifies what the current task is asking for before the learner answers."],
  [Lightbulb, "Hint", "Points to the next analytical step without naming the finding."],
  [Terminal, "Command", "Provides safe command context when a task involves terminal evidence."],
  [Brain, "Quiz", "Checks understanding with a question tied to the current case."],
] as const;

export default function LabsPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="Investigation labs"
        title="Work the evidence, then explain what it proves."
        description="Amniora was designed around investigations with synthetic evidence, clear tasks and case-based guidance. This cancelled-project demo shows fixed local examples."
        secondaryLabel="View features"
        secondaryHref="/features"
      />

      <section className="bg-paper">
        <div className="layout-workspace grid gap-space-8 py-10 sm:py-12 lg:grid-cols-[0.38fr_1fr] lg:py-14">
          <div>
            <p className="type-label font-semibold uppercase text-primary">Lab structure</p>
            <h2 className="mt-space-2 text-3xl font-semibold leading-tight text-heading sm:text-4xl">A lab gives you a case brief, evidence and tasks.</h2>
            <p className="mt-space-4 text-base leading-7 text-text-secondary">Each investigation asks you to read the supplied material and write evidence-backed findings.</p>
          </div>
          <div className="border-y border-border bg-white">
            {caseIndex.map(([label, value], index) => (
              <div key={label} className="grid gap-space-2 border-b border-border-subtle px-space-4 py-space-4 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <div className="flex items-baseline gap-space-3">
                  <span className="font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                  <dt className="text-sm font-semibold text-heading">{label}</dt>
                </div>
                <dd className="min-w-0 text-sm leading-6 text-text-secondary">{value}</dd>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ProductSection
        muted
        eyebrow="Using evidence"
        title="Use the right evidence for each claim"
        description="A file can support one kind of claim and not another. Account records, logs, approvals and exports each have different uses."
      >
        <div className="grid gap-space-3 md:grid-cols-2">
          {evidenceBands.map(([kind, file, use]) => (
            <article key={kind} className="grid gap-space-3 border-l border-border-strong bg-white py-space-4 pl-space-4 pr-space-3">
              <div className="grid gap-space-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <h3 className="text-sm font-semibold text-heading">{kind}</h3>
                <code className="technical-value min-w-0 font-mono text-xs text-primary sm:text-right">{file}</code>
              </div>
              <p className="text-sm leading-6 text-text-secondary">{use}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        eyebrow="Difficulty"
        title="Difficulty changes the investigation work"
        description="Every difficulty keeps the same habit: make claims only from the evidence listed for the task. Higher difficulty asks for more correlation and clearer uncertainty."
      >
        <div className="border-y border-border bg-white">
          {difficulty.map(([level, evidence, output, duration], index) => (
            <article key={level} className="grid gap-space-3 border-b border-border-subtle px-space-4 py-space-4 last:border-b-0 md:grid-cols-[2.75rem_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.25fr)_6rem] md:items-start">
              <span className="font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="text-base font-semibold text-heading">{level}</h3>
              <p className="text-sm leading-6 text-text-secondary">{evidence}</p>
              <p className="text-sm leading-6 text-text-secondary">{output}</p>
              <p className="font-mono text-xs font-semibold uppercase text-text-muted md:text-right">{duration}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        muted
        eyebrow="Guidance"
        title="Guidance helps without taking over"
        description="Hints and task support point learners toward useful evidence while leaving the finding to the learner."
      >
        <div className="grid gap-space-3 md:grid-cols-2">
          {guidanceLedger.map(([Icon, title, text]) => (
            <article key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-space-3 border-t border-border-strong pt-space-4">
              <Icon size={18} className="mt-1 text-primary" aria-hidden="true" />
              <div>
                <h3 className="type-card-title text-heading">{title}</h3>
                <p className="mt-space-2 text-sm leading-6 text-text-secondary">{text}</p>
              </div>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        eyebrow="Preserved scope"
        title="Linux was the main implemented investigation category"
        description="The source preserves the implemented engine and other category scaffolding. Development has ended; no further environments are promised."
      >
        <div className="grid gap-space-5 sm:grid-cols-2">
          <div className="border-l border-border-strong pl-space-5">
            <FileSearch size={20} className="text-primary" aria-hidden="true" />
            <h3 className="mt-space-3 type-card-title text-heading">Implemented focus</h3>
            <p className="mt-space-2 type-body text-text-secondary">Linux investigation source covers system activity, account behaviour, policy evidence and review tasks. The local demo uses synthetic sample cases.</p>
          </div>
          <div className="border-l border-primary pl-space-5">
            <Gauge size={20} className="text-primary" aria-hidden="true" />
            <h3 className="mt-space-3 type-card-title text-heading">Original difficulty design</h3>
            <p className="mt-space-2 type-body text-text-secondary">The historical plan page explains the original difficulty and duration limits. The demo has no subscription or real authentication.</p>
          </div>
        </div>
      </ProductSection>

      <ProductCTA
        title="Explore a sample investigation."
        description="Open the local demo to inspect a fixed synthetic case. Live AI generation is disabled."
        secondaryHref="/pricing"
        secondaryLabel="Historical plan design"
      />
    </ProductPageShell>
  );
}
