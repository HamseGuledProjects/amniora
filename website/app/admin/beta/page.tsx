import AdminNavigation from "../AdminNavigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  CodeActions,
  CreateCodeForm,
  RevokeAllButton,
} from "./BetaControls";
import { setGlobalBetaAction } from "./actions";

type InvitationCode = {
  id: string;
  label: string;
  enabled: boolean;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  created_at: string;
};

type Redemption = {
  id: string;
  code_id: string | null;
  user_id: string;
  redeemed_at: string;
};

export default async function AdminBetaPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const query = (await searchParams)?.q?.trim().slice(0, 80) || "";

  let codesQuery = supabaseAdmin
    .from("beta_invitation_codes")
    .select(
      "id,label,enabled,max_redemptions,redemption_count,expires_at,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (query) codesQuery = codesQuery.ilike("label", `%${query}%`);

  const [settingsResult, codesResult, redemptionsResult] = await Promise.all([
    supabaseAdmin
      .from("app_settings")
      .select("private_beta_enabled,updated_at")
      .eq("id", true)
      .maybeSingle(),
    codesQuery,
    supabaseAdmin
      .from("beta_redemptions")
      .select("id,code_id,user_id,redeemed_at")
      .order("redeemed_at", { ascending: false })
      .limit(50),
  ]);

  if (settingsResult.error || codesResult.error || redemptionsResult.error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto max-w-7xl">
          <AdminNavigation />
          <h1 className="text-2xl font-bold">Private Beta</h1>
          <p className="mt-4 text-red-300">
            Private-beta management data is unavailable. Apply the Patch 2.7
            migration before using this page.
          </p>
        </div>
      </main>
    );
  }

  const codes = (codesResult.data || []) as InvitationCode[];
  const redemptions = (redemptionsResult.data || []) as Redemption[];
  const userIds = [...new Set(redemptions.map((item) => item.user_id))];
  const codeIds = [
    ...new Set(
      redemptions
        .map((item) => item.code_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [profilesResult, labelsResult] = await Promise.all([
    userIds.length
      ? supabaseAdmin.from("profiles").select("id,email,full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    codeIds.length
      ? supabaseAdmin
          .from("beta_invitation_codes")
          .select("id,label")
          .in("id", codeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profiles = new Map(
    (profilesResult.data || []).map((profile) => [profile.id, profile]),
  );
  const labels = new Map(
    (labelsResult.data || []).map((code) => [code.id, code.label]),
  );
  const enabled = settingsResult.data?.private_beta_enabled === true;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AdminNavigation />

        <header>
          <p className="text-sm font-medium text-cyan-300">
            Admin / Private Beta
          </p>
          <h1 className="mt-2 text-3xl font-bold">Private Beta Management</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Control availability, issue one-time invitation secrets, and review
            managed redemptions.
          </p>
        </header>

        <section className="mt-7 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-400">Global Beta</p>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    enabled
                      ? "bg-emerald-400/15 text-emerald-300"
                      : "bg-red-400/15 text-red-300"
                  }`}
                >
                  {enabled ? "Enabled" : "Disabled"}
                </span>
                <span className="text-sm text-slate-400">
                  {enabled
                    ? "Approved users can access Amniora."
                    : "Only administrators can access protected features."}
                </span>
              </div>
            </div>
            <form action={setGlobalBetaAction}>
              <input type="hidden" name="enabled" value={String(!enabled)} />
              <button
                className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${
                  enabled
                    ? "border border-red-400/40 text-red-300"
                    : "bg-cyan-400 text-slate-950"
                }`}
              >
                {enabled ? "Disable Private Beta" : "Enable Private Beta"}
              </button>
            </form>
          </div>
          <div className="mt-5 border-t border-white/10 pt-5">
            <RevokeAllButton />
            <p className="mt-2 text-xs text-slate-500">
              Revocation changes stored user access. Disabling the global beta
              does not delete access records.
            </p>
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h2 className="text-xl font-semibold">Create Invitation Code</h2>
          <p className="mt-1 text-sm text-slate-400">
            Plaintext is returned once. Only its SHA-256 digest is stored.
          </p>
          <div className="mt-5">
            <CreateCodeForm />
          </div>
        </section>

        <section className="mt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Invitation Codes</h2>
              <p className="mt-1 text-sm text-slate-400">
                {codes.length} matching code{codes.length === 1 ? "" : "s"}
              </p>
            </div>
            <form className="flex w-full max-w-md gap-2">
              <input
                name="q"
                defaultValue={query}
                placeholder="Search labels"
                className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 text-white"
              />
              <button className="rounded-lg border border-white/15 px-4 text-sm font-semibold">
                Search
              </button>
            </form>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {codes.map((code) => {
              return (
                <article
                  key={code.id}
                  className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/70 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{code.label}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Created {formatDate(code.created_at)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        code.enabled
                          ? "bg-emerald-400/15 text-emerald-300"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {code.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Usage</dt>
                      <dd className="mt-1 text-slate-200">
                        {code.redemption_count} /{" "}
                        {code.max_redemptions ?? "Unlimited"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Expiration</dt>
                      <dd className="mt-1 text-slate-200">
                        {code.expires_at
                          ? formatDate(code.expires_at)
                          : "Never"}
                      </dd>
                    </div>
                  </dl>
                  <CodeActions codeId={code.id} enabled={code.enabled} />
                </article>
              );
            })}
            {!codes.length && (
              <p className="rounded-2xl border border-white/10 p-6 text-slate-400">
                No invitation codes found.
              </p>
            )}
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h2 className="text-xl font-semibold">Recent Redemptions</h2>
          <div className="mt-4 space-y-3">
            {redemptions.map((redemption) => {
              const profile = profiles.get(redemption.user_id);
              return (
                <div
                  key={redemption.id}
                  className="grid gap-1 rounded-lg border border-white/10 p-3 text-sm sm:grid-cols-3"
                >
                  <span className="min-w-0 break-words text-white">
                    {profile?.full_name || profile?.email || redemption.user_id}
                  </span>
                  <span className="text-slate-300">
                    {redemption.code_id
                      ? labels.get(redemption.code_id) || "Deleted code"
                      : "Deleted code"}
                  </span>
                  <time className="text-slate-400 sm:text-right">
                    {formatDate(redemption.redeemed_at)}
                  </time>
                </div>
              );
            })}
            {!redemptions.length && (
              <p className="text-sm text-slate-400">No redemptions yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}
