import { BRAND } from "@/lib/brand";

export const PASSWORD_RECOVERY_PATH = "/reset-password";
export const PASSWORD_RECOVERY_VERIFIED_PARAM = "verified";
export const PASSWORD_RECOVERY_INVALID_PARAM = "invalid";

export function getPasswordRecoveryRedirectUrl(origin: string = BRAND.url) {
  const callbackUrl = new URL(
    "/callback",
    getPasswordRecoveryRedirectOrigin(origin),
  );
  callbackUrl.searchParams.set("next", PASSWORD_RECOVERY_PATH);
  return callbackUrl.toString();
}

function getPasswordRecoveryRedirectOrigin(candidate: string) {
  try {
    const parsed = new URL(candidate);
    const isLocal =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    const isAmnioraHost =
      parsed.hostname === "portfolio.example.test" ||
      parsed.hostname === BRAND.domain ||
      parsed.hostname.endsWith(".portfolio.example.test");

    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && (isLocal || isAmnioraHost)) {
      return parsed.origin;
    }
  } catch {
    return BRAND.url;
  }

  return BRAND.url;
}

export function sanitizePasswordRecoveryReturnPath(
  candidate: string | null | undefined,
) {
  if (!candidate || candidate.length > 256) return null;

  try {
    const parsed = new URL(candidate, "https://amniora.invalid");
    if (
      parsed.origin !== "https://amniora.invalid" ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    ) {
      return null;
    }

    let decodedPathname = parsed.pathname;
    for (let pass = 0; pass < 2; pass += 1) {
      decodedPathname = decodeURIComponent(decodedPathname);
    }

    return decodedPathname === PASSWORD_RECOVERY_PATH
      ? PASSWORD_RECOVERY_PATH
      : null;
  } catch {
    return null;
  }
}
