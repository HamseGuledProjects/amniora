import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import DeleteUserButton from "./DeleteUserButton";
import ResetPasswordButton from "./ResetPasswordButton";
import RoleActionButton from "./RoleActionButton";
import AdminNavigation from "../AdminNavigation";

type AdminUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  plan: string | null;
  role: string | null;
  xp: number | null;
  level: string | null;
  labs_generated: number | null;
  labs_completed: number | null;
  created_at: string | null;
};

async function setPlan(formData: FormData) {
  "use server";

  await requireAdmin();

  const userId = String(formData.get("userId") || "");
  const plan = String(formData.get("plan") || "free");

  if (!userId) throw new Error("Missing user id");

  if (!["free", "pro"].includes(plan)) {
    throw new Error("Invalid plan");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ plan })
    .eq("id", userId);

  if (profileError) throw new Error(profileError.message);

  const { error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        plan,
        status: plan === "pro" ? "active" : "inactive",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id",
      }
    );

  if (subscriptionError) throw new Error(subscriptionError.message);

  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const query = params?.q?.trim() || "";

  let usersQuery = supabaseAdmin
    .from("profiles")
    .select(
      `
      id,
      full_name,
      email,
      plan,
      role,
      xp,
      level,
      labs_generated,
      labs_completed,
      created_at
    `
    )
    .order("created_at", { ascending: false });

  if (query) {
    usersQuery = usersQuery.or(
      `email.ilike.%${query}%,full_name.ilike.%${query}%`
    );
  }

  const { data, error } = await usersQuery;

  const users = (data || []) as AdminUser[];

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-7xl">
          <AdminNavigation />
          <p className="text-red-400">{error.message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AdminNavigation />
        <div className="mb-6">
          <p className="text-sm font-medium text-cyan-300">Admin / Users</p>
          <h1 className="mt-2 text-3xl font-bold">User Management</h1>
          <p className="mt-2 text-slate-400">
            View users, reset passwords, change roles, change plans, and delete accounts.
          </p>

          <form method="GET" className="mt-5 flex max-w-xl gap-3">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search by email or name..."
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />

            <button
              type="submit"
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300"
            >
              Search
            </button>

            {query && (
              <a
                href="/admin/users"
                className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
              >
                Clear
              </a>
            )}
          </form>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">XP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Labs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-400">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/10">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-4">
                      <p className="font-medium text-white">{user.full_name || "Unnamed user"}</p>
                      <p className="text-sm text-slate-400">{user.email}</p>
                      <p className="mt-1 text-xs text-slate-600">{user.id}</p>
                    </td>

                    <td className="px-4 py-4">
                      <form action={setPlan}>
                        <input type="hidden" name="userId" value={user.id} />
                        <select
                          name="plan"
                          defaultValue={user.plan || "free"}
                          className="rounded-lg border border-cyan-400/30 bg-slate-950 px-3 py-2 text-sm text-cyan-300"
                        >
                          <option value="free">free</option>
                          <option value="pro">pro</option>
                        </select>
                        <button className="ml-2 rounded-lg bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">
                          Save
                        </button>
                      </form>
                    </td>

                    <td className="px-4 py-4 text-purple-300">{user.role || "user"}</td>
                    <td className="px-4 py-4 text-slate-300">{user.xp ?? 0}</td>
                    <td className="px-4 py-4 text-slate-300">
                      {user.labs_completed ?? 0} / {user.labs_generated ?? 0}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-400">
                      {user.created_at
                        ? new Date(user.created_at).toLocaleDateString("en-GB")
                        : "Unknown"}
                    </td>

                    <td className="space-y-2 px-4 py-4 text-right">
                      <ResetPasswordButton email={user.email || ""} />

                      {user.role === "admin" ? (
                        <RoleActionButton userId={user.id} email={user.email || ""} role="user" />
                      ) : (
                        <RoleActionButton userId={user.id} email={user.email || ""} role="admin" />
                      )}

                      {user.role === "admin" ? (
                        <span className="block text-xs text-slate-500">Delete protected</span>
                      ) : (
                        <DeleteUserButton userId={user.id} email={user.email || ""} />
                      )}
                    </td>
                  </tr>
                ))}

                {!users.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
