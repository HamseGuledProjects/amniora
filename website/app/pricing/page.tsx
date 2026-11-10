import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo";
import { AI_CONFIG } from "@/lib/ai/config";
import { ProductHero, ProductPageShell } from "../components/public/ProductPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Historical Plan Design",
  description:
    "Review the historical Free and Pro design from the cancelled Amniora project. No plans or payments are available.",
  path: "/pricing",
});

const ledgerRows = [
  ["Roadmap", "Included", "Included"],
  ["Saved investigations", "Included", "Included"],
  ["AI Tutor", `${AI_CONFIG.FREE.WEEKLY_TUTOR_PROMPTS} prompts per week`, `${AI_CONFIG.PRO.WEEKLY_TUTOR_PROMPTS} prompts per week`],
  ["Lab generation", `${AI_CONFIG.FREE.WEEKLY_LAB_GENERATIONS} per week`, `${AI_CONFIG.PRO.WEEKLY_LAB_GENERATIONS} per week`],
  ["Difficulty", "Beginner and Intermediate", "Beginner, Intermediate and Advanced"],
  ["Duration", "Up to 30 minutes", "Up to 60 minutes"],
  ["Task guidance", "Not included", "Included for supported tasks"],
] as const;

const statusNotes = [
  ["Checkout", "Disabled. This demo has no checkout."],
  ["Pro price", "No paid plan is offered."],
  ["Data status", "Synthetic examples are for local review only."],
] as const;

export default function PricingPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="Historical plan design"
        title="Review the original Free and Pro design."
        description="This comparison preserves the original plan configuration. Amniora is cancelled, so these allowances are historical design details, not an offer to subscribe."
        primaryLabel="Open local demo"
        primaryHref="/dashboard"
        secondaryLabel="Project history"
        secondaryHref="/development-log"
      />

      <section className="bg-paper">
        <div className="layout-workspace py-10 sm:py-12 lg:py-14">
          <div className="grid gap-space-7 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
            <aside className="border-y border-border bg-white px-space-4 py-space-5">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-primary">Plan comparison</p>
              <h2 className="mt-space-3 text-2xl font-semibold leading-tight text-heading">The project is cancelled.</h2>
              <p className="mt-space-3 text-sm leading-6 text-text-secondary">
                The original interface is preserved for review. This demo does not create accounts, charge money or call an AI provider.
              </p>
            </aside>

            <div className="border-y border-border bg-white" aria-label="Historical plan design comparison">
              <div className="hidden grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border bg-paper-muted sm:grid">
                <div className="px-space-4 py-space-3 text-xs font-semibold uppercase text-text-muted">Access</div>
                <div className="border-l border-border px-space-4 py-space-3">
                  <h3 className="text-sm font-semibold text-heading">Free</h3>
                  <p className="mt-space-1 text-xs leading-5 text-text-secondary">Original core plan design.</p>
                </div>
                <div className="border-l border-border px-space-4 py-space-3">
                  <h3 className="text-sm font-semibold text-heading">Pro</h3>
                  <p className="mt-space-1 text-xs leading-5 text-text-secondary">No subscription available.</p>
                </div>
              </div>
              {ledgerRows.map(([capability, free, pro]) => (
                <article key={capability} className="grid gap-space-3 border-b border-border-subtle px-space-4 py-space-4 last:border-b-0 sm:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-0 sm:px-0 sm:py-0">
                  <h3 className="min-w-0 text-sm font-semibold leading-6 text-heading sm:px-space-4 sm:py-space-3">{capability}</h3>
                  <div className="grid gap-space-1 border-l border-border-subtle pl-space-3 sm:block sm:px-space-4 sm:py-space-3">
                    <p className="text-xs font-semibold uppercase text-text-muted sm:hidden">Free</p>
                    <p className="min-w-0 text-sm leading-6 text-text-secondary">{free}</p>
                  </div>
                  <div className="grid gap-space-1 border-l border-primary pl-space-3 sm:border-border-subtle sm:px-space-4 sm:py-space-3">
                    <p className="text-xs font-semibold uppercase text-text-muted sm:hidden">Pro</p>
                    <p className="min-w-0 text-sm leading-6 text-text-secondary">{pro}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border-subtle bg-paper-muted">
        <div className="layout-workspace py-10 sm:py-12 lg:py-14">
          <div className="grid gap-space-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-start">
            <div>
              <h2 className="text-2xl font-semibold leading-tight text-heading sm:text-3xl">Historical limits are shown for context.</h2>
              <p className="mt-space-3 max-w-2xl text-base leading-7 text-text-secondary">
                No wider release or paid access is planned. The local sample can be explored without subscribing.
              </p>
            </div>
            <dl className="grid gap-space-3">
              {statusNotes.map(([label, value]) => (
                <div key={label} className="grid gap-space-2 border-t border-border-strong pt-space-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-sm font-semibold text-heading">{label}</dt>
                  <dd className="text-sm leading-6 text-text-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="bg-paper">
        <div className="layout-workspace py-10 sm:py-12 lg:py-14">
          <div className="grid gap-space-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <p className="max-w-2xl text-sm leading-6 text-text-secondary">
              Review the <Link href="/terms" className="font-semibold text-primary hover:underline">Terms</Link> or the <Link href="/development-log" className="font-semibold text-primary hover:underline">Development Log</Link> for portfolio scope and historical updates.
            </p>
            <Link href="/dashboard" className="inline-flex min-h-11 items-center justify-center rounded-ui-sm bg-primary px-space-5 text-sm font-semibold text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2">
              Open local demo
            </Link>
          </div>
        </div>
      </section>
    </ProductPageShell>
  );
}
