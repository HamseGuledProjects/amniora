import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookOpenText, KeyRound, ShieldAlert } from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import { publicPageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { sanitizeInternalReturnPath } from "@/lib/auth/routeAccess";
import BetaAccessForm from "./BetaAccessForm";

export const metadata: Metadata = publicPageMetadata({
  title: "Private Beta Access",
  description:
    "Sign in to use an existing Amniora private beta key and review current private-beta safety guidance.",
  path: "/beta-access",
});

const betaNotes = [
  "Use synthetic data only while Amniora is in active development.",
  "Saved information can change, reset or be deleted without notice.",
  "Development is cancelled. This archive does not accept enrolment.",
] as const;

type BetaAccessPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function BetaAccessPage({
  searchParams,
}: BetaAccessPageProps) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const returnTo = sanitizeInternalReturnPath(next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/beta-access");

  return (
    <main className="min-h-screen bg-investigation text-white">
      <section className="border-b border-white/15 bg-[linear-gradient(135deg,#071426_0%,#0b1f38_52%,#102b49_100%)]">
        <div className="mx-auto grid min-h-screen w-full max-w-6xl gap-space-8 px-4 py-space-6 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:px-8">
          <div className="max-w-xl">
            <BrandLogo size="lg" theme="dark" />
            <p className="mt-space-8 font-mono text-xs uppercase tracking-[0.18em] text-blue-100/75">
              Private beta access
            </p>
            <h1 className="mt-space-4 text-4xl font-semibold leading-[1.04] tracking-[-0.015em] text-white sm:text-5xl">
              Use your private beta key.
            </h1>
            <p className="mt-space-5 text-base leading-7 text-blue-50/78">
              Enter your existing key to activate private beta access for your signed-in account.
            </p>
            <dl className="mt-space-8 grid gap-space-3 border-y border-white/15 py-space-5 sm:grid-cols-3">
              <div>
                <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-blue-100/55">State</dt>
                <dd className="mt-space-1 text-sm font-semibold text-white">Signed in</dd>
              </div>
              <div>
                <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-blue-100/55">New enrolment</dt>
                <dd className="mt-space-1 text-sm font-semibold text-white">Coming soon</dd>
              </div>
              <div>
                <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-blue-100/55">Data</dt>
                <dd className="mt-space-1 text-sm font-semibold text-white">Synthetic only</dd>
              </div>
            </dl>
            <div className="mt-space-6 grid gap-space-3 text-sm leading-6 text-blue-50/74">
              {betaNotes.map((note) => (
                <p key={note} className="flex gap-space-3">
                  <ShieldAlert size={17} className="mt-1 shrink-0 text-amber-200" aria-hidden="true" />
                  <span>{note}</span>
                </p>
              ))}
            </div>
          </div>

          <div className="relative border border-white/18 bg-paper p-space-4 text-text shadow-[0_28px_80px_rgba(0,0,0,0.28)] sm:p-space-5">
            <div className="mb-space-5 flex items-start justify-between gap-space-4 border-b border-border pb-space-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Private beta</p>
                <h2 className="mt-space-2 text-2xl font-semibold leading-tight text-heading">Continue with a private beta key</h2>
              </div>
              <KeyRound size={22} className="mt-1 shrink-0 text-primary" aria-hidden="true" />
            </div>
            <BetaAccessForm returnTo={returnTo} />
            <div className="mt-space-5 grid gap-space-3 border-t border-border pt-space-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <p className="flex gap-space-2 text-sm leading-6 text-text-secondary">
                <BookOpenText size={17} className="mt-1 shrink-0 text-primary" aria-hidden="true" />
                You can return to the public site to read the latest product updates.
              </p>
              <Link
                href="/"
                className="inline-flex min-h-10 items-center justify-center gap-space-2 rounded-ui-sm border border-border-strong px-space-4 text-sm font-semibold text-text outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Public home
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
