// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* Isolated fixture: real React components, synthetic responses, no real product/Runner calls. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import SavedLabLocalRunner from "../../../app/dashboard/saved/[id]/SavedLabLocalRunner";
import TaskCard from "../../../app/dashboard/saved/[id]/TaskCard";
import SavedLabHints from "../../../app/dashboard/saved/[id]/SavedLabHints";
import Button from "../../../app/components/ui/Button";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") || "ready";
const topic = scenario === "linux" ? "Linux" : "Web Security";
const pkg = window.__phase15bPackage;
const build = { buildId: pkg.buildId, buildFingerprint: pkg.buildFingerprint, runtimeVersion: pkg.runtimeVersion };
const idle = () => ({ state: "idle", sessionId: null, buildId: null, buildFingerprint: null, generation: null,
  endpoint: null, createdAt: null, expiresAt: null, trustLevel: "local_self_hosted" });
const ready = (generation = 1) => ({ state: "ready", sessionId: "a".repeat(32), buildId: build.buildId,
  buildFingerprint: build.buildFingerprint, generation, endpoint: "http://127.0.0.1:45678",
  createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, trustLevel: "local_self_hosted" });
const storageKey = "phase15b-fixture-status-" + scenario;
let runtime = JSON.parse(sessionStorage.getItem(storageKey) || "null") || (["already", "foreign", "unsafe", "failed-status"].includes(scenario) ? ready() : idle());
if (scenario === "foreign") runtime.buildId = "other-saved-build";
if (scenario === "unsafe") runtime.endpoint = "https://attacker.example/";
if (scenario === "failed-status") { runtime.state = "failed"; runtime.endpoint = null; runtime.errorCode = "LOCAL_RUNTIME_START_FAILED"; }
const cloudStorageKey = "phase17b-fixture-status-" + scenario;
const cloudBase = state => ({ state, createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + (scenario === "cloud-expiring" ? 8 : 30) * 60_000).toISOString(),
  openAvailable: state === "ready", resetAvailable: state === "ready", stopAvailable: !["expired", "failed"].includes(state) });
let cloudRuntime = JSON.parse(sessionStorage.getItem(cloudStorageKey) || "null") ||
  (scenario === "cloud-starting" ? cloudBase("starting") : ["cloud-ready", "cloud-expiring"].includes(scenario) ? cloudBase("ready") : null);
const fixture = window.__phase15b = {
  requests: [], unexpectedRequests: [], opened: [], hold: null, release: null, ready: false,
  get runtime() { return runtime; },
  set runtime(value) { runtime = value; },
  scene: scenario,
};
const response = data => new Response(JSON.stringify({ data, error: null }), {
  status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const errorResponse = code => new Response(JSON.stringify({ data: null, error: { code } }), {
  status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const pause = signal => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
  const abort = () => { fixture.release = null; reject(new DOMException("Aborted", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
  fixture.release = () => { fixture.release = null; signal?.removeEventListener("abort", abort); resolve(); };
});
window.fetch = async (input, options = {}) => {
  const url = new URL(String(input), location.origin);
  const method = options.method || "GET";
  const local = url.origin === "http://127.0.0.1:43127";
  fixture.requests.push({ path: url.pathname, method, local }); // Never retain capabilities or package bodies.
  if (fixture.hold === url.pathname) await pause(options.signal);
  if (url.origin === location.origin && url.pathname === "/api/web-labs/local-runner/fixture-saved-lab") {
    if (scenario === "flagoff" || scenario === "vm-only") return response({ enabled: false, eligible: false, build: null });
    if (scenario === "static") return response({ enabled: true, eligible: false, build: null });
    return response({ enabled: true, eligible: true, build });
  }
  // Phase 16B remains default-off in this Phase 15B regression fixture.
  if (url.origin === location.origin && url.pathname === "/api/web-labs/my-vm/fixture-saved-lab") {
    if (scenario === "vm-only" || scenario.startsWith("cloud-")) return response({ enabled: true, eligible: true, runners: [] });
    return response({ enabled: false, eligible: false, runners: [] });
  }
  if (url.origin === location.origin && url.pathname === "/api/web-labs/cloud/fixture-saved-lab") {
    const cloudScenario = scenario.startsWith("cloud-");
    const plan = scenario === "cloud-free" ? "free" : "pro";
    const availability = scenario === "cloud-capacity" ? "capacity_full" :
      scenario === "cloud-unavailable" ? "service_disabled" : plan === "free" ? "plan_required" : "available";
    const snapshot = () => ({ enabled: cloudScenario, eligible: cloudScenario, plan, availability, runtime: cloudRuntime });
    if (method === "GET") return response(snapshot());
    const body = JSON.parse(options.body);
    if (body.action === "launch") { cloudRuntime = cloudBase("ready"); sessionStorage.setItem(cloudStorageKey, JSON.stringify(cloudRuntime)); return response(snapshot()); }
    if (body.action === "reset") { cloudRuntime = cloudBase("ready"); sessionStorage.setItem(cloudStorageKey, JSON.stringify(cloudRuntime)); return response(snapshot()); }
    if (body.action === "stop") { cloudRuntime = null; sessionStorage.removeItem(cloudStorageKey); return response(snapshot()); }
    if (body.action === "open") return response({ action: location.origin + "/__amniora/cloud/launch",
      handoff: "a".repeat(48) + "." + "b".repeat(43), expiresAt: new Date(Date.now() + 20_000).toISOString() });
    return errorResponse("INVALID_REQUEST");
  }
  if (url.origin === location.origin && url.pathname === "/api/web-labs/local-runner/fixture-saved-lab/package") {
    return response({ package: scenario === "privileged" ? { ...pkg, providerReference: "must-reject" } : pkg });
  }
  if (url.origin === location.origin && url.pathname === "/api/ai/task-assist") {
    const { mode } = JSON.parse(options.body);
    const text = mode === "quiz" ? "Question: Which evidence should you inspect?\nA) Supplied catalogue\nB) An unrelated account\nCorrect answer: A\nExplanation: Use only supplied evidence."
      : mode === "command" ? "printf 'Synthetic fixture guidance'" : `Synthetic ${mode} guidance from an offline fixture.`;
    return new Response(JSON.stringify({ response: text }), { headers: { "Content-Type": "application/json" } });
  }
  if (!local) {
    fixture.unexpectedRequests.push({ origin: url.origin, path: url.pathname });
    throw new Error("Fixture refused unexpected request");
  }
  if (scenario === "offline") throw new TypeError("Synthetic connection refusal");
  if (url.pathname === "/v1/capabilities") return response({
    runnerVersion: "15.0.0-alpha.1", protocolVersion: scenario === "version" ? "0.9" : "1.0",
    platform: scenario === "unsupported" ? "win32" : "darwin", architecture: "arm64", testedPlatform: scenario !== "unsupported",
    docker: { commandAvailable: scenario !== "docker-missing", daemonReachable: scenario !== "docker", serverVersion: "fixture" },
    supportedRuntimeVersions: ["web-lab-local-1"], activeLocalRuntimeState: runtime.state,
    protocolCompatibility: scenario === "version" ? "incompatible" : "compatible",
    outcome: scenario === "docker" ? "DOCKER_DAEMON_UNAVAILABLE" : scenario === "docker-missing" ? "DOCKER_UNAVAILABLE" : scenario === "unsupported" ? "UNSUPPORTED_PLATFORM" : "RUNNER_READY",
  });
  if (url.pathname === "/v1/status") return response(runtime);
  if (url.pathname === "/v1/authorize") {
    const { operation } = JSON.parse(options.body);
    return response({ capability: "fixture-capability-not-a-secret-" + "x".repeat(16), operation, expiresAt: Date.now() + 30_000 });
  }
  if (url.pathname === "/v1/launch") {
    if (scenario === "failure") return errorResponse("LOCAL_RUNTIME_START_FAILED");
    runtime = ready();
    sessionStorage.setItem(storageKey, JSON.stringify(runtime));
    return response(runtime);
  }
  if (url.pathname === "/v1/reset") { runtime = ready(runtime.generation + 1); sessionStorage.setItem(storageKey, JSON.stringify(runtime)); return response(runtime); }
  if (url.pathname === "/v1/stop") { runtime = idle(); sessionStorage.setItem(storageKey, JSON.stringify(runtime)); return response(runtime); }
  fixture.unexpectedRequests.push({ origin: url.origin, path: url.pathname });
  throw new Error("Fixture refused undocumented Runner request");
};
window.open = (url, target, features) => { fixture.opened.push({ url, target, features }); return null; };
HTMLFormElement.prototype.submit = function() {
  fixture.opened.push({ url: this.action, target: this.target, method: this.method,
    handoffField: this.querySelector('input[type="hidden"]')?.name || null });
};
// Links are inspected without navigating away to a nonexistent fixture challenge.
document.addEventListener("click", event => {
  const anchor = event.target.closest?.("a");
  if (anchor?.textContent.trim() === "Open Lab") { fixture.opened.push({ url: anchor.href, target: anchor.target, rel: anchor.rel }); event.preventDefault(); }
});

function Fixture() {
  const [previewState, setPreviewState] = useState(params.get("runnerPreview"));
  useEffect(() => {
    fixture.setPreviewState = setPreviewState;
    return () => { delete fixture.setPreviewState; };
  }, []);
  return <main className="min-h-screen bg-[#0c1828] p-space-4 text-white sm:p-space-6" data-fixture-surround>
    <div className="mx-auto max-w-6xl space-y-space-5">
      <header className="rounded-[4px] border border-white/10 bg-[#071426] px-space-4 py-space-5 sm:px-space-5">
        <p className="type-metadata text-cyan-200/75">Saved Investigation · isolated UI fixture</p>
        <h1 className="mt-space-2 text-2xl font-semibold text-white">Investigate a synthetic product review</h1>
        <p className="type-body mt-space-3 text-slate-300">{topic} · Beginner · 30 minutes</p>
        <div className="mt-space-4"><Button variant="secondary" className="border-white/15 bg-white/[0.04] text-white">Download evidence</Button></div>
      </header>
      <SavedLabLocalRunner savedLabId="fixture-saved-lab" topic={topic} previewState={previewState} />
      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white" data-fixture-task-section>
        <div className="border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
          <p className="type-label text-cyan-200/75">Task focus</p>
          <h2 className="type-section-title mt-space-1 text-white">Investigation Tasks (1)</h2>
        </div>
        <div className="p-space-4 sm:p-space-5"><TaskCard labId="fixture-saved-lab" task={JSON.stringify({
          phase: "Observe", title: "Review the supplied catalogue", evidence: ["catalogue/reviews"],
          deliverable: "Describe what the synthetic review demonstrates and what it cannot prove.",
        })} index={0} isPro={params.get("plan") === "pro"} difficulty="Beginner" /></div>
      </section>
      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-5 text-white" data-fixture-hints>
        <h2 className="type-section-title mb-space-4">Hints</h2>
        <SavedLabHints hints={["Trace where the harmless submitted value appears in the rendered page.", "Compare the browser's interpretation with the text you expected to see."]} />
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
fixture.ready = true;
