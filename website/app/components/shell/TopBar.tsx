import type { ReactNode } from "react";

type TopBarProps = {
  actions?: ReactNode;
};

export default function TopBar({ actions }: TopBarProps) {
  if (!actions) return null;

  return (
    <header
      className="sticky top-0 z-20 mb-3 hidden max-w-full items-center justify-end bg-[#0c1828]/95 text-slate-100 backdrop-blur-sm lg:flex"
      data-authenticated-app-header
    >
      <div className="flex items-center gap-space-2">{actions}</div>
    </header>
  );
}
