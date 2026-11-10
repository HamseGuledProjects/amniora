"use client";

import { usePathname } from "next/navigation";
import DevelopmentBanner from "./DevelopmentBanner";
import ServiceStatusBanner from "./ServiceStatusBanner";

function isAuthenticatedAppPath(pathname: string | null) {
  return Boolean(
    pathname?.startsWith("/dashboard") ||
      pathname?.startsWith("/admin"),
  );
}

export default function GlobalStatusRegion() {
  const pathname = usePathname();

  if (isAuthenticatedAppPath(pathname)) return null;

  return (
    <div className="w-full shrink-0" data-global-status-region>
      <DevelopmentBanner />
      <ServiceStatusBanner />
    </div>
  );
}
