import type { ReactNode } from "react";
import PortfolioDemoBanner from "../../../components/layout/PortfolioDemoBanner";

type AppShellProps = {
  mobileHeader: ReactNode;
  sidebar: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
};

export default function AppShell({
  mobileHeader,
  sidebar,
  topBar,
  children,
}: AppShellProps) {
  return (
    <main className="fixed inset-0 flex h-screen h-dvh min-h-screen w-full max-w-full flex-col overflow-hidden bg-[#0c1828] text-text" data-authenticated-shell>
      <div className="sticky top-0 z-50 w-full shrink-0" data-authenticated-global-stack>
        <PortfolioDemoBanner />
        {mobileHeader}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-authenticated-workspace>
        {sidebar}
        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-y-auto overflow-x-clip bg-[#0c1828] lg:h-full" data-authenticated-main-region>
          <div className="mx-auto flex min-h-full w-full max-w-[90rem] flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-5 lg:px-7 lg:py-4" data-authenticated-content-frame>
            {topBar}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
