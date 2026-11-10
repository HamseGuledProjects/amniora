import { AlertTriangle } from "lucide-react";

export function EarlyAccessInvestigationBanner() {
  return (
    <aside
      role="alert"
      aria-label="Synthetic investigation example"
      className="print:hidden w-full border border-red-500/70 bg-[#3b151e] p-space-3 text-red-50 sm:p-space-4"
    >
      <div className="flex items-start gap-space-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
        <div className="min-w-0">
          <p className="type-caption font-bold uppercase tracking-[0.12em] text-red-200">LOCAL EXAMPLE</p>
          <h2 className="mt-space-1 text-base font-semibold leading-snug text-white sm:text-lg">
            Explore a synthetic investigation
          </h2>
          <p className="type-body mt-space-1 max-w-4xl text-red-50">
            This fixed sample lets you explore tasks, evidence and exports. Guidance is illustrative and automatic assessment is disabled. No VM or vulnerable lab is started by this website.
          </p>
        </div>
      </div>
    </aside>
  );
}
