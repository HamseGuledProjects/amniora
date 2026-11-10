#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

const helper = readText("lib/auth/passwordRecovery.ts");
const forgot = readText("app/forgot-password/page.tsx");
const callback = readText("app/callback/route.ts");
const reset = readText("app/reset-password/page.tsx");
const routeAccess = readText("lib/auth/routeAccess.ts");
const proxy = readText("proxy.ts");
const login = readText("app/login/page.tsx");
const signup = readText("app/signup/page.tsx");
const betaPage = readText("app/beta-access/page.tsx");
const betaForm = readText("app/beta-access/BetaAccessForm.tsx");
const adminReset = readText("app/api/admin/users/reset-password/route.ts");
const nextConfig = readText("next.config.ts");

const recoverySurface = `${helper}\n${forgot}\n${callback}\n${reset}\n${adminReset}`;

assert("recovery helper declares audited reset path", helper.includes('PASSWORD_RECOVERY_PATH = "/reset-password"'));
assert("recovery helper builds callback URL from a safe current origin", helper.includes("getPasswordRecoveryRedirectOrigin(origin)") && helper.includes('callbackUrl.searchParams.set("next", PASSWORD_RECOVERY_PATH)'));
assert("recovery helper allows localhost and Amniora origins only", helper.includes('parsed.hostname === "localhost"') && helper.includes('parsed.hostname === BRAND.domain') && helper.includes('return BRAND.url'));
assert("forgot-password uses current-origin callback recovery redirect", forgot.includes("getPasswordRecoveryRedirectUrl(window.location.origin)") && forgot.includes("resetPasswordForEmail"));
assert("forgot-password does not redirect directly to reset form", !forgot.includes('redirectTo: `${window.location.origin}/reset-password`') && !forgot.includes('redirectTo: `${BRAND.url}/reset-password`'));
assert("forgot-password does not expose account existence", forgot.includes("If an account exists for that email") && !forgot.includes("Password reset email sent. Check your inbox."));
assert("forgot-password does not display raw Supabase reset error", !forgot.includes("resetError.message"));
assert("admin password reset uses same canonical recovery redirect", adminReset.includes("getPasswordRecoveryRedirectUrl()") && adminReset.includes("resetPasswordForEmail"));
assert("admin reset route does not expose raw provider error", !adminReset.includes("error.message"));
assert("callback exchanges Supabase recovery code", callback.includes("exchangeCodeForSession(code)"));
assert("callback routes recovery next to reset-password", callback.includes("sanitizePasswordRecoveryReturnPath") && callback.includes("recoveryPath ?? \"/dashboard\""));
assert("callback ordinary auth still defaults to dashboard", callback.includes('recoveryPath ?? "/dashboard"'));
assert("callback marks invalid recovery links safely", callback.includes('destination.searchParams.set("recovery", PASSWORD_RECOVERY_INVALID_PARAM)'));
assert("callback marks successfully exchanged recovery links safely", callback.includes('destination.searchParams.set("recovery", PASSWORD_RECOVERY_VERIFIED_PARAM)'));
assert("callback does not log or expose callback errors", !/console\.|error\.message|JSON\.stringify\(error/.test(callback));
assert("recovery sanitizer rejects external origins", helper.includes("parsed.origin !== \"https://amniora.invalid\"") && helper.includes("parsed.username") && helper.includes("parsed.password"));
assert("recovery sanitizer rejects query and hash destinations", helper.includes("parsed.hash") && helper.includes("parsed.search"));
assert("recovery sanitizer allows only reset-password", helper.includes("decodedPathname === PASSWORD_RECOVERY_PATH"));
assert("generic return-path sanitizer still rejects auth routes", routeAccess.includes('routeAccess === "auth"') && routeAccess.includes("return fallback"));
assert("reset-password route remains auth-classified", /AUTH_ROUTES[\s\S]*"\/reset-password"/.test(routeAccess));
assert("reset-password remains noindexed", nextConfig.includes('source: "/reset-password"') && nextConfig.includes("X-Robots-Tag"));
assert("proxy preserves dashboard protection", proxy.includes("betaUrl.pathname = BETA_ACCESS_PATH") && proxy.includes("authorization.betaGranted") && proxy.includes("return redirectWithSession(betaUrl, response)"));
assert("reset page keeps an explicit recovery state machine", reset.includes('type RecoveryState = "verifying" | "ready" | "missing" | "invalid" | "error"') && reset.includes('recoveryState === "verifying"') && reset.includes('recoveryState === "ready"'));
assert("reset page requires verified recovery context before showing form", reset.includes("recoveryStatus !== PASSWORD_RECOVERY_VERIFIED_PARAM") && reset.includes('setRecoveryState("missing")') && reset.includes("recoveryState !== \"ready\""));
assert("reset page handles invalid or reused links safely", reset.includes("This password reset link is no longer valid. Request a new reset link and try again.") && reset.includes('href="/forgot-password"'));
assert("reset page does not call a missing session expired before auth initialization completes", reset.indexOf('recoveryState === "verifying"') < reset.indexOf('recoveryState === "missing"') && reset.includes("Checking your reset link…"));
assert("reset page distinguishes system verification errors from invalid links", reset.includes("We could not verify this reset link right now. Please try again in a moment.") && reset.includes('setRecoveryState("error")'));
assert("reset page removes recovery marker only after session verification", reset.includes('setRecoveryState("ready")') && reset.includes('router.replace("/reset-password")') && reset.indexOf('setRecoveryState("ready")') < reset.indexOf('router.replace("/reset-password")'));
assert("direct reset route does not allow unrelated signed-in session to validate recovery", reset.includes('recoveryStatus !== PASSWORD_RECOVERY_VERIFIED_PARAM') && reset.includes('setRecoveryState("missing")'));
assert("reset page updates password through existing Supabase client", reset.includes("supabase.auth.updateUser({ password })"));
assert("reset page keeps password policy", reset.includes("Password must be at least 8 characters") && reset.includes("uppercase") && reset.includes("lowercase") && reset.includes("number") && reset.includes("Passwords do not match"));
assert("reset page clears mismatch/error states before submit", reset.includes('setError("")') && reset.includes('setSuccess("")'));
assert("reset page does not expose raw provider update error", !reset.includes("resetError.message"));
assert("successful reset clears recovery session and sends user to login", reset.includes('supabase.auth.signOut({ scope: "local" })') && reset.includes('router.replace("/login")') && reset.includes("Password updated successfully"));
assert("ordinary login destination remains established", login.includes("getPostLoginDestination") && login.includes("sanitizeInternalReturnPath"));
assert("signup callback remains ordinary callback", signup.includes('emailRedirectTo: `${window.location.origin}/callback`'));
assert("recovery does not grant beta access", !/beta_access_granted|redeem_beta_access|user_access/.test(recoverySurface));
assert("beta access gate remains separate", betaPage.includes("<BetaAccessForm") && betaForm.includes("redeem_beta_access"));
assert("no recovery code or token stored in browser storage", !/localStorage|sessionStorage/.test(recoverySurface));
assert("no password is logged", !/console\.|password[^\n]*(URLSearchParams|searchParams|localStorage|sessionStorage)/i.test(recoverySurface));
assert("no secret-looking values are present", !/sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|RESEND_API_KEY|-----BEGIN .*PRIVATE KEY-----/.test(recoverySurface));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
