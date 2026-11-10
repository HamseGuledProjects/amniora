import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_STORAGE_KEY } from "./config";
import { demoAssets, demoLab, demoUser, initialDemoTables, type DemoRow } from "./fixtures";

type Result = { data: DemoRow[] | DemoRow | null; error: null; count: number };
let memory: Record<string, DemoRow[]> | null = null;
function tables() {
  if (memory) return memory;
  if (typeof window !== "undefined") {
    try { const stored = window.sessionStorage.getItem(DEMO_STORAGE_KEY); if (stored) memory = JSON.parse(stored); } catch { /* Storage is optional for the local sample. */ }
  }
  memory ??= structuredClone(initialDemoTables());
  return memory;
}
function save() { if (typeof window !== "undefined") { try { window.sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(tables())); } catch { /* A private browser session can keep data in memory. */ } } }

class DemoQuery implements PromiseLike<Result> {
  private filters: Array<(row: DemoRow) => boolean> = [];
  private singleRow = false;
  private head = false;
  private cap = 1000;
  private offset = 0;
  private sort: { key: string; ascending: boolean } | null = null;
  private operation: "read" | "insert" | "update" | "delete" = "read";
  private values: DemoRow[] = [];
  constructor(private table: string) {}
  select(columns = "*", options?: { head?: boolean }) { void columns; this.head = options?.head === true; return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
  is(key: string, value: unknown) { return this.eq(key, value); }
  gte(key: string, value: unknown) { this.filters.push(row => String(row[key]) >= String(value)); return this; }
  lte(key: string, value: unknown) { this.filters.push(row => String(row[key]) <= String(value)); return this; }
  gt(key: string, value: unknown) { this.filters.push(row => String(row[key]) > String(value)); return this; }
  lt(key: string, value: unknown) { this.filters.push(row => String(row[key]) < String(value)); return this; }
  order(key: string, options?: { ascending?: boolean }) { this.sort = { key, ascending: options?.ascending !== false }; return this; }
  limit(value: number) { this.cap = Math.max(0, value); return this; }
  range(from: number, to: number) { this.offset = Math.max(0, from); this.cap = Math.max(0, to - from + 1); return this; }
  single() { this.singleRow = true; return this; }
  maybeSingle() { return this.single(); }
  insert(value: DemoRow | DemoRow[]) { this.operation = "insert"; this.values = Array.isArray(value) ? value : [value]; return this; }
  upsert(value: DemoRow | DemoRow[]) { return this.insert(value); }
  update(value: DemoRow) { this.operation = "update"; this.values = [value]; return this; }
  delete() { this.operation = "delete"; return this; }
  private execute(): Result {
    const db = tables(); db[this.table] ??= [];
    const matches = (row: DemoRow) => this.filters.every(filter => filter(row));
    let rows = db[this.table].filter(matches);
    if (this.operation === "insert") { rows = this.values.map(value => ({ id: `demo-${crypto.randomUUID()}`, ...value })); db[this.table].push(...rows); save(); }
    if (this.operation === "update") { rows.forEach(row => Object.assign(row, this.values[0])); save(); }
    if (this.operation === "delete") { db[this.table] = db[this.table].filter(row => !matches(row)); save(); }
    const count = rows.length;
    if (this.sort) { const { key, ascending } = this.sort; rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1)); }
    rows = rows.slice(this.offset, this.offset + this.cap);
    return { data: this.head ? null : this.singleRow ? rows[0] ?? null : rows, error: null, count };
  }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected); }
}

export function createDemoClient(): SupabaseClient {
  const session = { user: demoUser, access_token: "synthetic-demo-session", token_type: "bearer", expires_in: 3600, refresh_token: "synthetic-demo-only" };
  const channel = { on() { return this; }, subscribe() { return this; }, unsubscribe: async () => ({ error: null }) };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: demoUser }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: demoUser.id, session_id: "synthetic-local-session" } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { user: demoUser, session }, error: null }),
      signUp: async () => ({ data: { user: demoUser, session }, error: null }),
      updateUser: async () => ({ data: { user: demoUser }, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: demoUser, session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => new DemoQuery(table),
    rpc: async () => ({ data: null, error: null }),
    channel: () => channel,
    removeChannel: async () => "ok",
  };
  // The existing UI uses this adapter's familiar query shape. No SDK client is constructed.
  return client as unknown as SupabaseClient;
}

export function resetDemoData() { memory = structuredClone(initialDemoTables()); save(); }

export function ensureDemoInvestigation() {
  const db = tables();
  if (!db.labs.some(row => row.id === demoLab.id)) db.labs.unshift(structuredClone(demoLab));
  if (!db.lab_assets.some(row => row.lab_id === demoLab.id)) db.lab_assets.push(...structuredClone(demoAssets));
  save();
}
