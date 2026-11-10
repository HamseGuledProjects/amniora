import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { ProductCTA, ProductHero, ProductPageShell, ProductSection } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Cybersecurity Learning Features",
  description:
    "Explore the evidence, task, guidance and review design preserved from the cancelled Amniora project.",
  path: "/features",
});

const caseFlow = [
  ["1", "Case brief", "The learner receives a scenario, time window and clear objective."],
  ["2", "Evidence index", "Logs, documents and artefacts are grouped by investigation role."],
  ["3", "Investigation task", "Each task names the output and the exact evidence learners should use."],
  ["4", "Finding review", "Feedback checks support, uncertainty and overclaims without replacing the learner's work."],
] as const;

const relationships = [
  ["Evidence", "Task", "Use only the files listed for the answer."],
  ["Observation", "Inference", "Learners separate what is seen from what is concluded."],
  ["Guidance", "Your work", "Support points you in the right direction without giving away the answer."],
  ["Saved lab", "Export", "The investigation can be reviewed later with stable files."],
] as const;

const capabilityLedger = [
  ["Generated evidence", "Synthetic logs, documents and exports are grouped by investigation role.", "Evidence packet"],
  ["Evidence for each task", "Each task lists the exact files the learner should use for that answer.", "Task requirement"],
  ["Guided support", "Hints and task guidance orient the learner without completing the finding.", "Learner aid"],
  ["Finding review", "Review expects observations, supported inferences and uncertainty to stay separate.", "Review"],
  ["Saved review", "Completed labs can be reopened with their learner-facing PDF and evidence ZIP.", "Saved lab"],
  ["Difficulty fit", "Difficulty changes correlation depth, evidence volume and remediation expectations.", "Learning level"],
] as const;

export default function FeaturesPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="Investigation tools"
        title="Investigate with evidence, tasks and guided review."
        description="The cancelled Amniora project was designed around evidence and careful findings. This local demo uses fixed synthetic examples to show that workflow."
        secondaryLabel="Explore labs"
        secondaryHref="/labs"
      />

      <section className="bg-paper">
        <div className="layout-workspace grid gap-space-8 py-10 sm:py-12 lg:grid-cols-[0.35fr_1fr] lg:py-14">
          <div>
            <p className="type-label font-semibold uppercase text-primary">How labs work</p>
            <h2 className="mt-space-2 text-3xl font-semibold leading-tight text-heading sm:text-4xl">Each lab follows a practical case flow.</h2>
            <p className="mt-space-4 text-base leading-7 text-text-secondary">Start with a brief, inspect the evidence, complete the tasks and review your findings.</p>
          </div>
          <ol className="grid gap-space-3 lg:grid-cols-4">
            {caseFlow.map(([number, title, text], index) => (
              <li key={title} className="relative border-t border-border-strong pt-space-4 lg:min-h-48">
                {index < caseFlow.length - 1 && <span className="absolute left-8 top-5 hidden h-px w-[calc(100%+1.5rem)] bg-border-strong lg:block" aria-hidden="true" />}
                <span className="relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-ui-sm bg-primary text-sm font-semibold text-white">{number}</span>
                <h3 className="mt-space-4 type-card-title text-heading">{title}</h3>
                <p className="mt-space-2 text-sm leading-6 text-text-secondary">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ProductSection
        muted
        eyebrow="Using evidence carefully"
        title="Know what each piece of evidence can support"
        description="Tasks identify which files to use so learners can separate observations, supported conclusions and uncertainty."
      >
        <div className="grid gap-space-3 md:grid-cols-2">
          {relationships.map(([left, right, note]) => (
            <article key={`${left}-${right}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-space-3 border-y border-border bg-white px-space-4 py-space-4">
              <p className="text-sm font-semibold text-heading">{left}</p>
              <span className="h-px w-8 bg-primary" aria-hidden="true" />
              <p className="text-sm font-semibold text-heading">{right}</p>
              <p className="col-span-3 text-sm leading-6 text-text-secondary">{note}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        eyebrow="Investigation tools"
        title="What the project was designed to support"
        description="The source includes investigation, guidance, export and review implementations. The demo uses sample data and canned responses."
      >
        <div className="border-y border-border bg-white">
          {capabilityLedger.map(([name, detail, surface], index) => (
            <article key={name} className="grid gap-space-3 border-b border-border-subtle px-space-4 py-space-4 last:border-b-0 md:grid-cols-[2.75rem_minmax(0,0.9fr)_minmax(0,1.35fr)_9rem] md:items-start">
              <span className="font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="min-w-0 text-sm font-semibold leading-6 text-heading">{name}</h3>
              <p className="min-w-0 text-sm leading-6 text-text-secondary">{detail}</p>
              <p className="min-w-0 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-text-muted md:text-right">{surface}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection
        muted
        eyebrow="Safe practice"
        title="Explore with synthetic examples"
        description="This portfolio is for lawful education and local review. Use the supplied sample information; no real accounts or hosted learning service are provided."
      >
        <div className="grid gap-space-4 md:grid-cols-[1fr_1fr_1fr]">
          {[
            [Sparkles, "Guidance", "Task support helps learners move forward without giving away the answer."],
            [ShieldCheck, "Use the listed evidence", "Findings should rely on the files listed for each task."],
            [Gauge, "Difficulty", "The original design included Beginner, Intermediate and Advanced investigations."],
          ].map(([Icon, title, text]) => (
            <article key={title as string} className="border-t border-border-strong pt-space-4">
              <Icon size={18} className="text-primary" aria-hidden="true" />
              <h3 className="mt-space-3 type-card-title text-heading">{title as string}</h3>
              <p className="mt-space-2 type-body text-text-secondary">{text as string}</p>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductCTA
        title="Explore the practical learning loop."
        description="See how the lab experience turns a scenario into evidence-backed investigation work."
        secondaryHref="/pricing"
        secondaryLabel="Historical plan design"
      />
    </ProductPageShell>
  );
}
