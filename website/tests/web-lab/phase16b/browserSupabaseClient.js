// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
class FixtureQuery {
  constructor(table) { this.table = table; this.mode = "select"; this.patch = null; }
  select() { return this; }
  update(value) { this.mode = "update"; this.patch = value; return this; }
  eq() { return this; }
  order() { return Promise.resolve(this.result(false)); }
  single() { return Promise.resolve(this.result(true)); }
  then(resolve, reject) { return Promise.resolve(this.result(false)).then(resolve, reject); }
  result(single) {
    if (this.table === "profiles") return { data: { plan: "free" }, error: null };
    if (this.table === "labs") {
      if (this.mode === "update" && this.patch) Object.assign(window.__phase16bLab, this.patch);
      return { data: single ? window.__phase16bLab : [window.__phase16bLab], error: null };
    }
    if (this.table === "lab_assets") return { data: [], error: null };
    return { data: single ? null : [], error: null };
  }
}

export function createClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } }, error: null }) },
    from: table => new FixtureQuery(table),
  };
}
