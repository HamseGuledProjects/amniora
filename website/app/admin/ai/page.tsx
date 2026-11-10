import { loadAdminAiAnalytics } from "@/lib/admin/aiAnalytics";
import AdminNavigation from "../AdminNavigation";

export default async function AdminAIPage() {
  const result = await loadAdminAiAnalytics();
  if (!result.ok) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-7xl">
          <AdminNavigation />
          <h1 className="text-2xl font-bold">AI Analytics</h1>
          <p className="mt-4 text-red-400">
            AI analytics are unavailable right now. Please try again in a moment.
          </p>
        </div>
      </main>
    );
  }

  const { events } = result.data;

  const stats = [
    { label: "Total AI Requests", value: result.data.totalRequests },
    { label: "Tutor Prompts", value: result.data.tutorRequests },
    { label: "Lab Generations", value: result.data.labGenerations },
    { label: "Linux Gradings", value: result.data.linuxGradings },
    { label: "Total Tokens", value: result.data.totalTokens.toLocaleString() },
    { label: "Estimated Cost", value: `£${result.data.totalCost.toFixed(4)}` },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AdminNavigation />
        <div className="mb-6">
          <p className="text-sm font-medium text-cyan-300">Admin / AI</p>
          <h1 className="mt-2 text-3xl font-bold">AI Analytics</h1>
          <p className="mt-2 text-slate-400">
            Track AI requests, token usage, model usage and estimated costs.
          </p>
        </div>

        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"
            >
              <p className="text-sm text-slate-400">{stat.label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </section>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Feature
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Plan
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Input
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Output
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                    Date
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/10">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-4 text-sm text-cyan-300">
                      {event.featureType}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-300">
                      {event.model}
                    </td>
                    <td className="px-4 py-4 text-sm text-purple-300">
                      {event.plan}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-300">
                      {event.inputTokens}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-300">
                      {event.outputTokens}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-300">
                      {event.totalTokens}
                    </td>
                    <td className="px-4 py-4 text-sm text-green-300">
                      £{event.estimatedCost.toFixed(6)}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-400">
                      {event.createdAt
                        ? new Date(event.createdAt).toLocaleString("en-GB")
                        : "Unknown"}
                    </td>
                  </tr>
                ))}

                {!events.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      No AI usage events yet.
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
