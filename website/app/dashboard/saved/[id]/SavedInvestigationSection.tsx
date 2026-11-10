import type { ReactNode } from "react";

// The existing Saved Lab section, shared without changing its presentation.
export default function SavedInvestigationSection({ step, icon, eyebrow, title, children }: {
  step?: string; icon: ReactNode; eyebrow: string; title: string; children: ReactNode;
}) {
  return (
    <section data-saved-investigation-section="dark" className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white">
      <div className="flex items-center gap-space-3 border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
        {step ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-cyan-300/25 bg-cyan-300/10 text-xs font-bold tabular-nums text-cyan-100" aria-hidden="true">{step}</span> : null}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-cyan-100/15 bg-[#071426] text-cyan-100"><span aria-hidden="true">{icon}</span></div>
        <div><p className="type-label text-cyan-200/75">{eyebrow}</p><h2 className="type-section-title mt-0.5 text-white">{title}</h2></div>
      </div>
      <div className="p-space-5">{children}</div>
    </section>
  );
}
