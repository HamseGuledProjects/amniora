import { createHash } from "node:crypto";

export function stableLabId(seed: string, moduleId: "reflected-xss" | "stored-xss" = "reflected-xss", templateId: "helpdesk" | "ecommerce" = "helpdesk"): string {
  const identity = `${templateId}:1.0.0:${moduleId}:1.0.0:${seed}`;
  return `web-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function seedHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function seededRandom(seed: string) {
  let state = Number.parseInt(seedHash(seed), 16) || 1;
  return {
    int(maxExclusive: number) {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) throw new Error("Invalid seeded choice size");
      state = (state + 0x6d2b79f5) | 0;
      let next = Math.imul(state ^ (state >>> 15), 1 | state);
      next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
      return Math.floor((((next ^ (next >>> 14)) >>> 0) / 4294967296) * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("Cannot choose from an empty fixture list");
      return items[this.int(items.length)];
    },
  };
}
