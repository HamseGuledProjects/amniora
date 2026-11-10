import { PORTFOLIO_DEMO } from "@/lib/portfolio-demo/config";

export default function DevelopmentBanner() {
  if (PORTFOLIO_DEMO) return null;
  return (
    <aside
      aria-label="Private beta notice"
      className="beta-warning w-full shrink-0 px-3 py-1 text-private-beta sm:px-6 sm:py-1.5"
      data-private-beta-notice
    >
      <div className="beta-warning__inner mx-auto w-full">
        <div className="flex items-center justify-center gap-2 text-center text-[0.72rem] leading-4 sm:gap-space-3 sm:text-sm sm:leading-5">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 bg-private-beta" />
          <p className="min-w-0 font-medium text-ink">
            <span className="font-semibold">Cancelled project.</span> This local example uses synthetic data.
          </p>
        </div>
      </div>
    </aside>
  );
}
