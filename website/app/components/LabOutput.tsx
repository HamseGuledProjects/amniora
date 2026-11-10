import Link from "next/link";
import type { Lab } from "../types/lab";

type LabOutputProps = {
  lab: Lab | null;
  isLoggedIn: boolean;
};

export default function LabOutput({ lab, isLoggedIn }: LabOutputProps) {
  if (!lab) {
    return (
      <div className="max-h-[520px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-6 shadow-2xl">
        <p className="text-sm text-gray-400">
          Your generated cybersecurity lab will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[520px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-6 shadow-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-400">
          Generated Lab
        </p>

        <span className="max-w-full rounded-full border border-cyan-400/30 px-3 py-1 text-xs text-cyan-300">
          {lab.difficulty}
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="break-words text-2xl font-bold text-white">{lab.title}</h3>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="max-w-full break-words rounded-full bg-cyan-400/10 px-3 py-1 text-cyan-300">
            {lab.topic}
          </span>

          <span className="max-w-full break-words rounded-full bg-white/5 px-3 py-1 text-gray-300">
            {lab.estimatedTime}
          </span>

          <span className="max-w-full break-words rounded-full bg-white/5 px-3 py-1 text-gray-300">
            Training Lab
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-4 text-sm leading-7 text-gray-200">
        <section>
          <h4 className="font-semibold text-cyan-400">Objective</h4>
          <p className="break-words">{lab.objective}</p>
        </section>

        {isLoggedIn ? (
          <>
            <section>
              <h4 className="font-semibold text-cyan-400">Scenario</h4>
              <p className="break-words">{lab.scenario}</p>
            </section>

            <section>
              <h4 className="font-semibold text-cyan-400">Tasks</h4>
              <ul className="list-disc pl-5">
                {lab.tasks?.map((task, index) => (
                  <li className="break-words" key={index}>{task}</li>
                ))}
              </ul>
            </section>

            <section>
              <h4 className="font-semibold text-cyan-400">Hints</h4>
              <ul className="list-disc pl-5">
                {lab.hints?.map((hint, index) => (
                  <li className="break-words" key={index}>{hint}</li>
                ))}
              </ul>
            </section>

            <section>
              <h4 className="font-semibold text-cyan-400">
                Learning Outcomes
              </h4>
              <ul className="list-disc pl-5">
                {lab.outcomes?.map((outcome, index) => (
                  <li className="break-words" key={index}>{outcome}</li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-cyan-400/20 bg-[#07111f] p-5 text-center shadow-2xl">
            <h4 className="font-semibold text-white">Continue with Amniora</h4>

            <p className="mt-2 text-sm text-gray-300">
              Log in or create a free account to unlock the full lab, save
              progress, and access the dashboard.
            </p>

            <div className="mt-4 flex justify-center gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-300"
              >
                Log in
              </Link>

              <Link
                href="/signup"
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-gray-300 transition hover:border-cyan-400 hover:text-cyan-300"
              >
                Sign up
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
