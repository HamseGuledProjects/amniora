export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
export const BETA_ACCESS_PATH = "/beta-access";
const DESIGN_SYSTEM_QA_PATH = "/design-system";

export type RouteAccess =
  | "public"
  | "auth"
  | "beta"
  | "protected"
  | "admin"
  | "internal";

const PUBLIC_ROUTES = new Set([
  "/",
  "/about",
  "/contact",
  "/cookies",
  "/development-log",
  "/features",
  "/labs",
  "/pricing",
  "/privacy",
  "/roadmap",
  "/terms",
]);

const AUTH_ROUTES = new Set([
  "/callback",
  "/forgot-password",
  "/login",
  "/reset-password",
  "/signup",
]);

const INTERNAL_PREFIXES = ["/api", "/_next", "/_vercel", "/.well-known"];

function isLocalDesignSystemQaRoute(pathname: string) {
  return (
    pathname === DESIGN_SYSTEM_QA_PATH &&
    process.env.NODE_ENV !== "production" &&
    process.env.AMNIORA_ENABLE_DESIGN_SYSTEM_QA === "1"
  );
}
function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyRoute(pathname: string): RouteAccess {
  if (
    INTERNAL_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix)) ||
    isLocalDesignSystemQaRoute(pathname)
  ) {
    return "internal";
  }

  if (PUBLIC_ROUTES.has(pathname)) return "public";
  if (
    Array.from(AUTH_ROUTES).some((route) => matchesPrefix(pathname, route))
  ) {
    return "auth";
  }
  if (matchesPrefix(pathname, BETA_ACCESS_PATH)) return "beta";
  if (matchesPrefix(pathname, "/admin")) return "admin";

  // New page routes are protected by default until deliberately classified.
  return "protected";
}

export function sanitizeInternalReturnPath(
  candidate: string | null | undefined,
  fallback = DEFAULT_AUTHENTICATED_PATH,
  options: { allowBetaAccess?: boolean } = {},
) {
  if (
    !candidate ||
    candidate.length > 2_048 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://amniora.invalid");
    const parsed = new URL(candidate, base);

    if (parsed.origin !== base.origin || parsed.username || parsed.password) {
      return fallback;
    }

    let decodedPathname = parsed.pathname;
    for (let pass = 0; pass < 2; pass += 1) {
      decodedPathname = decodeURIComponent(decodedPathname);
    }

    if (
      !decodedPathname.startsWith("/") ||
      decodedPathname.startsWith("//") ||
      decodedPathname.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decodedPathname)
    ) {
      return fallback;
    }

    const routeAccess = classifyRoute(parsed.pathname);
    if (
      routeAccess === "auth" ||
      (routeAccess === "beta" && !options.allowBetaAccess) ||
      routeAccess === "internal"
    ) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export function getRequestReturnPath(pathname: string, search: string) {
  return sanitizeInternalReturnPath(`${pathname}${search}`);
}
