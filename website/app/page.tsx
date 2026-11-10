import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  LifeBuoy,
  ShieldCheck,
} from "lucide-react";
import PublicFooter from "./components/PublicFooter";
import PublicNavbar from "./components/PublicNavbar";
import ProductProofDemo from "./components/ProductProofDemo";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Amniora | Hands-on Cybersecurity Investigation Labs",
  description:
    "Practice cybersecurity investigation with realistic synthetic evidence, structured tasks and guidance that helps learners reason through each case.",
  path: "/",
});

const proofRows = [
  ["assets/logs/auth.log", "identity signal", "Task 1"],
  ["assets/scheduled/cron.d/platform-sync", "scheduled definition", "Task 2"],
  ["assets/docs/change_request.md", "approval scope", "Task 3"],
  ["assets/runtime/process_execution_history.txt", "historical execution", "Task 4"],
] as const;

const progression = [
  {
    level: "Beginner",
    evidence: "Small evidence set with direct file references.",
    task: "One clear output per task, written in plain language.",
    limits: "Name what the evidence proves and one thing it cannot prove.",
  },
  {
    level: "Intermediate",
    evidence: "More files across identity, timing, policy and activity records.",
    task: "Correlate related evidence and explain gaps without checklist prose.",
    limits: "Separate observed facts from supported inference before recommending action.",
  },
  {
    level: "Advanced",
    evidence: "Broader case material with richer state, history and approval boundaries.",
    task: "Build a concise finding across multiple evidence types and competing explanations.",
    limits: "State scope limits, approval gaps and unsupported conclusions clearly.",
  },
] as const;

const supportRows = [
  [LifeBuoy, "Hints", "Support for the next investigation step."],
  [ClipboardCheck, "Grading", "Feedback based on the evidence supplied for the task."],
  [ShieldCheck, "Evidence limits", "Base each finding on the supplied case materials."],
] as const;

const trustNotes = [
  "Synthetic evidence is built for practice, not for storing sensitive or production data.",
  "Each task names the files learners should use for that answer.",
  "Product development is cancelled. This local edition preserves the interface with synthetic examples.",
] as const;

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-muted">
        {eyebrow}
      </p>
      <h2 className="mt-space-3 text-2xl font-semibold leading-tight text-heading sm:text-3xl">
        {title}
      </h2>
      <p className="mt-space-3 text-base leading-7 text-text-secondary">
        {text}
      </p>
    </div>
  );
}

function EvidencePreview() {
  return (
    <div className="border-y border-border bg-white" aria-label="Synthetic evidence preview">
      <div className="grid gap-space-3 border-b border-border px-space-4 py-space-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-space-5 sm:py-space-4">
        <div>
          <p className="type-label font-semibold text-heading">Synthetic evidence packet</p>
          <p className="type-body-sm mt-space-1 text-text-secondary">
            Each task lists the learner-visible files needed for that answer.
          </p>
        </div>
        <FileSearch size={20} className="text-primary" aria-hidden="true" />
      </div>
      <div className="divide-y divide-border-subtle">
        {proofRows.map(([file, role, task]) => (
          <div key={file} className="grid gap-space-2 px-space-4 py-space-3 sm:px-space-5 md:grid-cols-[1.1fr_.75fr_.45fr] md:items-center">
            <code className="technical-value font-mono text-xs text-heading">{file}</code>
            <p className="type-body-sm text-text-secondary">{role}</p>
            <p className="type-caption font-medium text-verified">{task}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border bg-paper-muted px-space-4 py-space-3 sm:px-space-5">
        <p className="type-body-sm text-text-secondary">
          Example task: cite the scheduled definition before naming the command or run-as account.
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="overflow-x-clip bg-paper text-text">
      <PublicNavbar />

      <section className="homepage-hero surface-investigation border-b border-investigation-line">
        <div className="layout-workspace py-7 sm:py-8 lg:py-9">
          <div className="homepage-hero__grid">
            <div className="homepage-hero__copy motion-copy-enter">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue-100/70">Hands-on cybersecurity learning</p>
              <h1 className="mt-space-4 text-3xl font-semibold leading-[1.04] text-white sm:text-4xl lg:text-[2.65rem] xl:text-[3.05rem]">
                Build practical cybersecurity judgement.
              </h1>
              <p className="mt-space-4 text-base leading-7 text-blue-50/78 sm:text-lg">
                Work through realistic synthetic investigations, follow guided tasks and get feedback on your findings.
              </p>
              <div className="mt-space-6 flex flex-col gap-space-3 sm:flex-row lg:flex-col xl:flex-row">
                <Link href="/dashboard" className="ui-action ui-action-dark-primary ui-action-arrow" data-primary-hero-cta="true">
                  Explore workspace
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link href="/labs" className="ui-action ui-action-dark-secondary">Explore labs</Link>
              </div>
              <p className="mt-space-4 text-sm leading-6 text-blue-50/72">
                Product development is cancelled. <Link href="/dashboard" className="font-medium text-blue-100 underline underline-offset-4 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-focus">Open the local demo</Link>; use synthetic, non-sensitive information only.
              </p>
            </div>
            <div className="homepage-hero__product motion-page-enter">
              <ProductProofDemo />
            </div>
          </div>

          <div className="homepage-hero__proof-row grid gap-space-3 border-t border-white/12 pt-space-4 font-mono text-xs uppercase tracking-[0.12em] text-blue-100/68 sm:grid-cols-4">
            <span>Synthetic evidence</span>
            <span>Evidence for this task</span>
            <span>Guided review</span>
            <span>Portfolio demo</span>
          </div>
        </div>
      </section>

      <section id="investigation-loop" className="homepage-method-section border-b border-investigation-line public-section">
        <div className="layout-workspace grid gap-space-10 lg:grid-cols-[.72fr_1.28fr] lg:items-start">
          <SectionHeading
            eyebrow="Follow the trace"
            title="Work through each investigation step by step."
            text="Use the listed evidence, explain what happened, state what the evidence does not prove, then review the result."
          />
          <div className="homepage-story-card"><EvidencePreview /></div>
        </div>
      </section>

      <section className="homepage-progression-section border-b border-border-subtle public-section">
        <div className="layout-workspace grid gap-space-8 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
          <SectionHeading
            eyebrow="Learning progression"
            title="Difficulty changes the investigation work."
            text="Every level uses the same habit with increasing evidence volume, correlation work and confidence limits."
          />
          <div className="homepage-progression-table overflow-hidden border border-border bg-surface">
            <div className="hidden grid-cols-[7rem_1fr_1fr_1fr] border-b border-border bg-paper-muted px-space-4 py-space-3 text-xs font-semibold uppercase text-text-secondary md:grid">
              <span>Level</span>
              <span>Evidence volume</span>
              <span>Task output</span>
              <span>Confidence and limits</span>
            </div>
            <div className="divide-y divide-border-subtle">
              {progression.map((item) => (
                <div key={item.level} className="homepage-progression-row grid gap-space-3 px-space-4 py-space-4 md:grid-cols-[7rem_1fr_1fr_1fr] md:gap-space-4">
                  <h3 className="type-card-title text-heading">{item.level}</h3>
                  <p className="type-body-sm text-text-secondary" data-label="Evidence volume">{item.evidence}</p>
                  <p className="type-body-sm text-text-secondary" data-label="Task output">{item.task}</p>
                  <p className="type-body-sm text-text-secondary" data-label="Confidence and limits">{item.limits}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="homepage-guidance-section border-b border-investigation-line py-12 sm:py-16">
        <div className="layout-workspace grid gap-space-8 lg:grid-cols-[1.1fr_.9fr] lg:items-start">
          <div>
            <SectionHeading
              eyebrow="Guidance and grading"
              title="AI support helps you think through the case."
              text="Ask for guidance when you need it, then get feedback based on the evidence supplied for each task."
            />
            <div className="mt-space-8 grid gap-space-5 sm:grid-cols-3">
              {supportRows.map(([Icon, title, text]) => (
                <div key={title} className="border-l border-border-strong pl-space-4">
                  <Icon size={20} className="text-primary" aria-hidden="true" />
                  <h3 className="mt-space-3 type-card-title text-heading">{title}</h3>
                  <p className="mt-space-1 type-body-sm text-text-secondary">{text}</p>
                </div>
              ))}
            </div>
          </div>
          <aside className="border-t border-border-strong pt-space-5 lg:border-l lg:border-t-0 lg:pl-space-6 lg:pt-0">
            <h3 className="type-card-title text-heading">Product status</h3>
            <ul className="mt-space-4 space-y-space-3">
              {trustNotes.map((note) => (
                <li key={note} className="flex gap-space-3 type-body text-text-secondary">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-verified" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
            <Link href="/development-log" className="mt-space-5 inline-flex min-h-10 items-center rounded-ui-sm text-sm font-semibold text-primary outline-none hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-focus">
              Read product updates
              <ArrowRight size={15} className="ml-space-2" aria-hidden="true" />
            </Link>
          </aside>
        </div>
      </section>

      <section className="homepage-closing-section py-12 sm:py-16">
        <div className="layout-public max-w-3xl text-center">
          <BookOpenCheck size={26} className="mx-auto text-primary" aria-hidden="true" />
          <h2 className="mt-space-4 text-2xl font-semibold leading-tight text-heading sm:text-3xl">Built for careful investigation practice.</h2>
          <p className="mx-auto mt-space-3 max-w-2xl text-base leading-7 text-text-secondary">
            The archived development log records the investigation, evidence and interface work completed before product development was cancelled.
          </p>
          <Link href="/development-log" className="mt-space-5 inline-flex min-h-10 items-center justify-center rounded-ui-sm text-sm font-semibold text-primary outline-none hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-focus">
            View the Development Log
            <ArrowRight size={15} className="ml-space-2" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
