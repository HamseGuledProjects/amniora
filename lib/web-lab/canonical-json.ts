function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map(key => [key, ordered(source[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(ordered(value));
}
