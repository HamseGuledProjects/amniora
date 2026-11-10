"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resetDemoData } from "@/lib/portfolio-demo/client";

export default function PortfolioDemoBanner({ publicOnly = false }: { publicOnly?: boolean }) {
  const pathname = usePathname();
  if (publicOnly && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) return null;
  async function reset() {
    resetDemoData();
    await fetch("/api/portfolio/reset", { method: "POST" });
    // A full navigation clears mounted page state after resetting the sample tables.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }
  return (
    <aside aria-label="Local portfolio demonstration" className="relative z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-cyan-200/20 bg-[#091728] px-4 py-2 text-center text-xs leading-5 text-slate-200">
      <span><strong className="text-cyan-200">Local portfolio demo.</strong> Synthetic data and example Tutor replies. No account or external service needed. Product development is cancelled.</span>
      <Link href="/dashboard" className="font-semibold text-cyan-200 underline underline-offset-2">Explore the workspace</Link>
      <button type="button" onClick={reset} className="text-slate-300 underline underline-offset-2">Reset sample data</button>
    </aside>
  );
}
