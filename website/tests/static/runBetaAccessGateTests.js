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

const page = readText("app/beta-access/page.tsx");
const form = readText("app/beta-access/BetaAccessForm.tsx");
const routeAccess = readText("lib/auth/routeAccess.ts");
const proxy = readText("proxy.ts");
const authorizer = readText("lib/auth/betaAccessAuthorization.ts");
const managementMigration = readText("supabase/migrations/20260728095503_production_private_beta_management.sql");
const foundationMigration = readText("supabase/migrations/20260728082000_private_beta_access_foundation.sql");
const secureMigration = readText("supabase/migrations/20260728084220_secure_private_beta_invitation_redemption.sql");
const adminPage = readText("app/admin/beta/page.tsx");
const adminActions = readText("app/admin/beta/actions.ts");
const adminControls = readText("app/admin/beta/BetaControls.tsx");
const signup = readText("app/signup/page.tsx");
const login = readText("app/login/page.tsx");
const callback = readText("app/callback/route.ts");
const sitemap = readText("app/sitemap.ts");
const publicRoutesBlock = routeAccess.match(/const PUBLIC_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";

const betaSurface = `${page}\n${form}`;

assert("beta page keeps public metadata helper", page.includes("publicPageMetadata") && page.includes('path: "/beta-access"'));
assert("beta page keeps authenticated beta gate content", page.includes("Use an existing key inside an authenticated session.") && page.includes("Private beta gate") && page.includes("Use synthetic data only"));
assert("beta page distinguishes existing keys from new enrolment", page.includes("Existing access") && page.includes("New enrolment") && page.includes("Coming soon"));
assert("beta page remains canonical but not public shell", page.includes("publicPageMetadata") && page.includes('redirect("/login?next=/beta-access")') && !page.includes("ProductHero"));
assert("beta page uses focused authenticated gate shell", page.includes("<BetaAccessForm") && page.includes("BrandLogo") && !page.includes("ProductPageShell"));
assert("focused gate does not import public navbar directly", !page.includes("PublicNavbar") && !page.includes("PublicFooter"));
assert("focused gate does not render dashboard navigation", !/Dashboard|Saved Labs|Settings|Admin \/ Private Beta/.test(betaSurface));
assert("existing-key card renders required copy", form.includes("Enter your private beta key.") && form.includes("Existing key holders can redeem access through the established secure flow."));
assert("existing-key card renders required label placeholder and button", form.includes("Private beta key") && form.includes("Enter your access key") && />\s*Continue\s*<\/Button>/.test(form));
assert("key input is accessible", form.includes('htmlFor="private-beta-key"') && form.includes('aria-describedby="beta-access-feedback beta-auth-state"'));
assert("key input disables browser persistence helpers", form.includes('autoComplete="off"') && form.includes('autoCapitalize="none"') && form.includes('spellCheck={false}'));
assert("keys are not stored in browser storage", !/localStorage|sessionStorage/.test(form));
assert("keys are not placed in URLs", !/invitationCode|private-beta-key|p_invitation_code/.test(page) && !/searchParams\.set\([^)]*invitation|URLSearchParams\([^)]*invitation|router\.push\([^)]*invitation|router\.replace\([^)]*invitation/.test(form));
assert("valid keys use established RPC path", form.includes('.rpc("redeem_beta_access"') && form.includes("p_invitation_code: invitationCode"));
assert("client preserves RPC-owned normalization semantics", !/invitationCode\.toUpperCase\(|p_invitation_code:\s*invitationCode\.trim\(|p_invitation_code:\s*invitationCode\.replace/.test(form));
assert("malformed and oversized values fail before RPC", form.includes("MAX_KEY_LENGTH = 128") && form.includes("invitationCode.length > MAX_KEY_LENGTH") && form.includes("Enter your private beta key."));
assert("invalid expired revoked consumed states share non-enumerating invalid state", managementMigration.includes("not v_code.enabled") && managementMigration.includes("v_code.expires_at") && managementMigration.includes("redemption_count >= v_code.max_redemptions") && form.includes("The private beta key is invalid."));
assert("rate limit semantics remain RPC-owned", managementMigration.includes("v_failed_attempts >= 5") && form.includes('response?.status === "rate_limited"'));
assert("beta disabled state remains RPC-owned", managementMigration.includes("private_beta_enabled") && form.includes('response?.status === "beta_disabled"'));
assert("redemption grants existing entitlement state", managementMigration.includes("insert into public.user_access") && managementMigration.includes("beta_access_granted") && authorizer.includes('.from("user_access")'));
assert("admin beta management reuses existing tables", adminPage.includes('from("beta_invitation_codes")') && adminActions.includes("admin_create_beta_invitation_code") && adminControls.includes("Revoke All Beta Access"));
assert("RLS remains enabled on beta tables", managementMigration.includes("alter table public.beta_invitation_codes enable row level security") && managementMigration.includes("alter table public.beta_redemptions enable row level security") && foundationMigration.includes("alter table public.user_access enable row level security"));
assert("RPC is authenticated-only", managementMigration.includes("grant execute on function public.redeem_beta_access(text) to authenticated") && !managementMigration.includes("grant execute on function public.redeem_beta_access(text) to anon"));
assert("raw invitation registry is not granted to browser roles", managementMigration.includes("revoke all on table public.app_settings") && !managementMigration.includes("grant select on table public.beta_invitation_codes to authenticated"));
assert("authenticated gated users see logout", form.includes("You are signed in and can redeem a private beta key.") && form.includes("Log out"));
assert("authenticated gated users do not see misleading Back action", !/>\s*Back\s*</.test(betaSurface));
assert("logout uses established secure sign-out flow", form.includes("supabase.auth.signOut()") && form.includes("router.replace(destination)") && form.includes("router.refresh()"));
assert("signed-out visitors are redirected before form render", page.includes("if (!user) redirect") && !form.includes("if (!isAuthenticated)"));
assert("signed-out visitors use established sign-in continuation", page.includes("/login?next=/beta-access") && login.includes("allowBetaAccess: true") && login.includes("sanitizeInternalReturnPath"));
assert("protected routes remain beta gated", proxy.includes("authorization.betaGranted") && proxy.includes("betaUrl.pathname = BETA_ACCESS_PATH") && proxy.includes("betaUrl.searchParams.set"));
assert("route access makes beta page auth gated and protected routes protected", !publicRoutesBlock.includes('"/beta-access"') && routeAccess.includes('return "beta"') && routeAccess.includes('return "protected"'));
assert("signup and callback do not redeem keys directly", !/redeem_beta_access|invitationCode|private-beta-key/.test(signup) && !/redeem_beta_access|invitationCode|private-beta-key/.test(callback));
assert("no duplicate beta architecture added in source", !fs.existsSync(path.join(ROOT, "app/api/beta-access")) && !fs.existsSync(path.join(ROOT, "app/api/beta")) && !fs.existsSync(path.join(ROOT, "app/private-beta")) && !fs.existsSync(path.join(ROOT, "app/join-beta")));
assert("no new beta migration file exists after established migrations", fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((name) => /beta/i.test(name)).every((name) => ["20260728082000_private_beta_access_foundation.sql", "20260728084220_secure_private_beta_invitation_redemption.sql", "20260728095503_production_private_beta_management.sql"].includes(name)));
assert("old secure redemption prerequisite remains documented", secureMigration.includes("supabase_vault") && readText("supabase/README.md").includes("amniora_private_beta_v1_digest"));
assert("new enrolment remains coming soon", page.includes("New enrolment") && page.includes("does not collect applications"));
assert("reduced motion behavior remains in focused gate and shell", form.includes("useReducedMotion") && readText("app/components/LandingMotion.tsx").includes("useReducedMotion"));
assert("mobile responsive grid remains", page.includes("lg:grid-cols") && form.includes("sm:grid-cols-2") && form.includes("grid gap-space-5"));
assert("public SEO surface does not expose key format or database details", !/AMNIORA-[A-Z0-9-]+|beta_invitation_codes|beta_redemptions|redeem_beta_access|p_invitation_code/.test(page));

assert("development log exit confirmation is accessible", form.includes("Leaving Beta Access will sign you out.") && form.includes("Stay here") && form.includes("Log out and view Development Log") && form.includes('aria-modal="true"') && form.includes('event.key === "Escape"'));
assert("exit control signs out through established auth client", form.includes("Log out and go back") && form.includes("supabase.auth.signOut()") && form.includes('signOutAndNavigate("/")'));
assert("beta return path is allowed only through login sanitization", routeAccess.includes("allowBetaAccess?: boolean") && login.includes("allowBetaAccess: true") && proxy.includes('routeAccess === "beta" ? BETA_ACCESS_PATH'));
assert("beta route is not public route access", !publicRoutesBlock.includes('"/beta-access"') && routeAccess.includes('return "beta"'));
assert("sitemap does not advertise authenticated beta route", !sitemap.includes('"/beta-access"') && !sitemap.includes('path: "/beta-access"'));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
