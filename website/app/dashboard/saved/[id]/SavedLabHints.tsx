"use client";

import { useState } from "react";
import Button from "@/app/components/ui/Button";

export default function SavedLabHints({ hints }: { hints: string[] }) {
  const [revealed, setRevealed] = useState<boolean[]>(() => hints.map(() => false));

  return (
    <ol className="space-y-space-3" data-saved-lab-progressive-hints>
      {hints.map((hint, index) => {
        const isRevealed = revealed[index] || false;
        const hintId = `saved-lab-hint-${index + 1}`;
        return (
          <li key={`${index}-${hint}`} className="rounded-[3px] border border-cyan-100/12 bg-[#061222] p-space-3">
            <div className="flex min-w-0 flex-col gap-space-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="type-body font-semibold text-slate-100">Hint {index + 1}</p>
              <Button
                variant="secondary"
                className="w-full border-cyan-100/15 bg-[#081827] text-slate-200 sm:w-auto"
                aria-expanded={isRevealed}
                aria-controls={hintId}
                onClick={() => setRevealed((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}
              >
                {isRevealed ? "Hide" : "Reveal"}
              </Button>
            </div>
            {isRevealed && (
              <p id={hintId} className="type-body mt-space-3 break-words border-t border-white/10 pt-space-3 leading-6 text-slate-200">
                {hint}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
