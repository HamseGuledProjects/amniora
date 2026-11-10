"use client";

type LabGeneratorProps = {
  difficulty: string;
  setDifficulty: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  duration: string;
  setDuration: (value: string) => void;
  isPro?: boolean;
  generateLab: () => void;
};

export default function LabGenerator({
  difficulty,
  setDifficulty,
  category,
  setCategory,
  duration,
  setDuration,
  isPro = false,
  generateLab,
}: LabGeneratorProps) {
  const freeBlocked =
    !isPro && ["60 mins", "90 mins", "120 mins"].includes(duration);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
      <h2 className="text-xl font-semibold">Create a lab</h2>

      <p className="mt-2 text-sm text-gray-400">
        Choose a category, difficulty and duration. Amniora will generate a
        structured lab with matching assets.
      </p>

      <div className="mt-6 space-y-5">
        <div>
          <label className="mb-2 block text-sm text-gray-300">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-cyan-400"
          >
            <option>Linux</option>
            <option>Networking</option>
            <option>Web Security</option>
            <option>OSINT</option>
            <option>Forensics</option>
            <option>Cloud Security</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-gray-300">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-cyan-400"
          >
            <option>Beginner</option>
            <option>Intermediate</option>
            {isPro && <option>Advanced</option>}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-gray-300">
            Estimated Duration
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-cyan-400"
          >
            <option>15 mins</option>
            <option>30 mins</option>
            <option>45 mins</option>
            <option disabled={!isPro}>60 mins</option>
            <option disabled={!isPro}>90 mins</option>
            <option disabled={!isPro}>120 mins</option>
          </select>

          {!isPro && (
            <p className="mt-2 text-xs text-gray-500">
              Free users can generate labs up to 15 and 30 minutes. Longer labs are a
              Pro feature.
            </p>
          )}

          {freeBlocked && (
            <p className="mt-2 rounded-xl border border-yellow-400/20 bg-yellow-400/10 p-3 text-xs text-yellow-200">
              Upgrade to Pro to generate labs longer than 45 minutes.
            </p>
          )}
        </div>

        <button
          onClick={generateLab}
          disabled={freeBlocked}
          className="w-full rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate Lab
        </button>
      </div>
    </div>
  );
}