type HeroProps = {
  title: string;
};

import Link from "next/link";

export default function Hero({ title }: HeroProps) {
  return (
    <div>
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
        Cybersecurity Lab Generator
      </p>

      <h1 className="text-5xl font-bold leading-tight md:text-6xl">
        {title}
      </h1>

      <p className="mt-6 max-w-xl text-lg text-gray-400">
        Pick a topic and difficulty level. Amniora creates structured
        beginner-friendly training scenarios for cybersecurity practice.
      </p>

      <div className="mt-8 flex gap-4">
        <button className="rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-black transition hover:bg-cyan-300">
          Generate Lab
        </button>

       <Link
  href="/dashboard"
  className="rounded-xl border border-white/10 px-6 py-3 text-gray-300 transition hover:border-cyan-400 hover:text-cyan-300"
>
  View Dashboard
</Link>
      </div>
    </div>
  );
}