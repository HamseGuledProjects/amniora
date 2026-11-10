import { createHash, randomBytes } from "crypto";

export const LINUX_SEED_FORMAT_VERSION = "linux-seed-v1";
export const LINUX_PRNG_ALGORITHM_VERSION = "sha256-counter-v1";

const MAX_SEED_LENGTH = 160;
const SEED_PATTERN = /^linux-seed-v1:[A-Za-z0-9_-]{16,128}$/;

export type DeterministicRandom = {
  readonly algorithm: typeof LINUX_PRNG_ALGORITHM_VERSION;
  readonly seed: string;
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  chance(probability: number): boolean;
  bytes(length: number): Uint8Array;
  id(namespace?: string): string;
  fork(namespace: string): DeterministicRandom;
};

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256Buffer(...parts: readonly string[]) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(":");
    hash.update(part);
    hash.update("|");
  }
  return hash.digest();
}

function sha256Hex(...parts: readonly string[]) {
  return sha256Buffer(...parts).toString("hex");
}

export function createLinuxRootSeed() {
  return `${LINUX_SEED_FORMAT_VERSION}:${base64Url(randomBytes(32))}`;
}

export function normalizeLinuxSeed(seed: string | undefined) {
  if (!seed) return createLinuxRootSeed();
  const trimmed = seed.trim();
  if (trimmed.length > MAX_SEED_LENGTH) {
    throw new Error("LINUX_GENERATION_SEED_INVALID: seed exceeds the supported length.");
  }
  if (SEED_PATTERN.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed)) {
    return `${LINUX_SEED_FORMAT_VERSION}:${base64Url(sha256Buffer("legacy-seed", trimmed)).slice(0, 43)}`;
  }
  throw new Error("LINUX_GENERATION_SEED_INVALID: seed format is not supported.");
}

export function deriveLinuxSeed(rootSeed: string, generatorVersion: string, namespace: string) {
  if (!namespace || /[\r\n]/.test(namespace)) {
    throw new Error("LINUX_GENERATION_CONTEXT_MISSING: deterministic namespace is required.");
  }
  return `${LINUX_SEED_FORMAT_VERSION}:${base64Url(sha256Buffer(rootSeed, generatorVersion, namespace)).slice(0, 43)}`;
}

export function deterministicUuid(seed: string, namespace = "id") {
  const bytes = Buffer.from(sha256Hex(seed, namespace).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function createDeterministicRandom(seed: string): DeterministicRandom {
  let counter = 0;

  function stream(length: number) {
    const output: number[] = [];
    while (output.length < length) {
      const block = sha256Buffer(LINUX_PRNG_ALGORITHM_VERSION, seed, String(counter));
      counter += 1;
      output.push(...block);
    }
    return Uint8Array.from(output.slice(0, length));
  }

  function uint32() {
    const bytes = stream(4);
    return ((bytes[0] * 0x1000000) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
  }

  const random: DeterministicRandom = {
    algorithm: LINUX_PRNG_ALGORITHM_VERSION,
    seed,
    nextFloat() {
      return uint32() / 0x100000000;
    },
    nextInt(minInclusive: number, maxExclusive: number) {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
        throw new Error("LINUX_GENERATION_SEED_INVALID: invalid deterministic integer range.");
      }
      const span = maxExclusive - minInclusive;
      const limit = Math.floor(0x100000000 / span) * span;
      let value = uint32();
      while (value >= limit) value = uint32();
      return minInclusive + (value % span);
    },
    pick<T>(items: readonly T[]) {
      if (items.length === 0) {
        throw new Error("LINUX_GENERATION_NONDETERMINISTIC_ORDER: deterministic pick received an empty collection.");
      }
      return items[random.nextInt(0, items.length)];
    },
    shuffle<T>(items: readonly T[]) {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = random.nextInt(0, index + 1);
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    },
    chance(probability: number) {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return random.nextFloat() < probability;
    },
    bytes(length: number) {
      if (!Number.isInteger(length) || length < 0 || length > 4096) {
        throw new Error("LINUX_GENERATION_SEED_INVALID: invalid deterministic byte length.");
      }
      return stream(length);
    },
    id(namespace = "id") {
      return deterministicUuid(seed, namespace);
    },
    fork(namespace: string) {
      return createDeterministicRandom(deriveLinuxSeed(seed, LINUX_PRNG_ALGORITHM_VERSION, namespace));
    },
  };

  return random;
}

export function stableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableCanonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`)
    .join(",")}}`;
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(stableCanonicalJson(value).replace(/\r\n/g, "\n")).digest("hex");
}
