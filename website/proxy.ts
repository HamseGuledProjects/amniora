import { NextResponse, type NextRequest } from "next/server";
import {
  BETA_ACCESS_PATH,
  classifyRoute,
  getRequestReturnPath,
  sanitizeInternalReturnPath,
} from "@/lib/auth/routeAccess";
import { updateSession } from "@/lib/supabase/proxy";
import { PORTFOLIO_DEMO } from "@/lib/portfolio-demo/config";
import { handleDemoApi } from "@/lib/portfolio-demo/api";

const SESSION_RESPONSE_HEADERS = ["cache-control", "expires", "pragma"] as const;

function redirectWithSession(
  destination: URL,
  sessionResponse: NextResponse,
) {
  const response = NextResponse.redirect(destination);

  sessionResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  SESSION_RESPONSE_HEADERS.forEach((name) => {
    const value = sessionResponse.headers.get(name);
    if (value) response.headers.set(name, value);
  });

  return response;
}

export async function proxy(request: NextRequest) {
  if (PORTFOLIO_DEMO) {
    const host = request.headers.get("host") || "";
    let localOrigin: URL;
    try { localOrigin = new URL(`http://${host}`); } catch { return NextResponse.json({ error: "Local demo requests require a loopback host." }, { status: 403 }); }
    if (localOrigin.username || localOrigin.password || !["127.0.0.1", "localhost", "[::1]"].includes(localOrigin.hostname)) {
      return NextResponse.json({ error: "This demo is available only through its local address." }, { status: 403 });
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== localOrigin.origin) return NextResponse.json({ error: "Cross-site requests are not accepted by the local demo." }, { status: 403 });
    const pathname = request.nextUrl.pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) return handleDemoApi(request);
    if (["/login", "/signup", "/forgot-password", "/reset-password", "/callback", "/auth/callback", "/beta-access"].includes(pathname) || pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/dashboard", localOrigin));
    }
    return NextResponse.next();
  }
  const routeAccess = classifyRoute(request.nextUrl.pathname);

  if (
    routeAccess === "public" ||
    routeAccess === "auth" ||
    routeAccess === "internal"
  ) {
    return NextResponse.next();
  }

  const { response, authorization } = await updateSession(request);
  const requestedReturnPath = getRequestReturnPath(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  const betaReturnPath = sanitizeInternalReturnPath(
    request.nextUrl.searchParams.get("next"),
  );

  if (!authorization.authenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      routeAccess === "beta" ? BETA_ACCESS_PATH : requestedReturnPath,
    );
    return redirectWithSession(loginUrl, response);
  }

  if (authorization.isAdmin) {
    if (routeAccess !== "beta") return response;

    const destination = new URL(betaReturnPath, request.nextUrl.origin);
    return redirectWithSession(destination, response);
  }

  if (routeAccess === "beta") {
    if (authorization.betaGranted) {
      const destination = new URL(betaReturnPath, request.nextUrl.origin);
      return redirectWithSession(destination, response);
    }

    // Keep the gate reachable when access state is absent or cannot be verified.
    return response;
  }

  if (authorization.betaGranted) {
    return response;
  }

  const betaUrl = request.nextUrl.clone();
  betaUrl.pathname = BETA_ACCESS_PATH;
  betaUrl.search = "";
  betaUrl.searchParams.set("next", requestedReturnPath);
  return redirectWithSession(betaUrl, response);
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff|woff2|ttf|otf|txt|xml|webmanifest)$).*)"],
};
