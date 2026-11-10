#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-requirement-renderer-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function main() {
  const out = compileIfNeeded();
  const {
    allLinuxLearnerRequirementKinds,
    renderLinuxLearnerRequirementSentence,
  } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { linuxNarrativeTextHygieneReason } = require(path.join(out, "linux", "narrativeIntegrity.js"));

  const requirements = allLinuxLearnerRequirementKinds();
  const keys = new Set();
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${requirement.id}`;
    assert(`${key} appears once`, !keys.has(key));
    keys.add(key);
    const rendered = renderLinuxLearnerRequirementSentence(requirement);
    assert(`${key} renders a non-empty sentence`, typeof rendered === "string" && rendered.trim().length > 0, rendered);
    assert(`${key} is deterministic`, rendered === renderLinuxLearnerRequirementSentence(requirement), rendered);
    assert(`${key} ends as a complete sentence`, /[.!?]$/.test(rendered), rendered);
    assert(`${key} passes learner text hygiene`, !linuxNarrativeTextHygieneReason(rendered), `${rendered} :: ${linuxNarrativeTextHygieneReason(rendered)}`);
    assert(`${key} does not expose its internal ID`, !new RegExp(requirement.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(rendered), rendered);
    assert(`${key} uses no generic fallback marker`, !/\b(?:Where relevant,\s+include|Include a sentence that|Also\s+\w+|It should\s+\w+)\b/i.test(rendered), rendered);
  }
  assert("unknown requirement fails closed", (() => {
    try {
      renderLinuxLearnerRequirementSentence({ kind: "incident_question", id: "unknown_requirement" });
      return false;
    } catch (error) {
      return /LINUX_LEARNER_REQUIREMENT_RENDERER_MISSING/.test(String(error?.message || error));
    }
  })());
  console.log(JSON.stringify({ passed: true, requirementKinds: requirements.length }, null, 2));
}

main();
