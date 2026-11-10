#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-path-provenance-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function assert(name, condition, detail = "") {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${name}`);
}

function baseView() {
  return {
    taskNumber: 1,
    learnerIntent: "Command and process correlation",
    learnerObjective: "Review file access evidence.",
    learnerInstruction: "Prepare evidence notes using only approved values.",
    allowedEvidence: [{ path: "assets/logs/audit.log", description: "audit.log" }],
    allowedSubjects: [{ index: 1, display: "/home/alice/.ssh/authorized_keys", type: "file" }],
    allowedRelationshipStatements: [{
      index: 1,
      learnerStatement: "The supplied evidence links PID 1200 cat to file activity involving /home/alice/.ssh/authorized_keys.",
      allowedClaimClass: "observed",
    }],
    allowedTimestamps: [],
    allowedTimestampStatements: [],
    allowedCurrentStateStatements: ["No current-state conclusion is permitted for this task."],
    allowedHistoricalStatements: ["Historical or observed statement may be based on supplied command records only."],
    allowedRecommendationStatements: ["Recommendations are limited to evidence gaps and the next validation step for this task."],
    allowedCapabilityDescriptions: ["Use the supplied command records to describe observed execution."],
    prohibitedTopics: ["Do not mention internal paths."],
    outputRequirements: ["Cite exact evidence path strings only from the allowed evidence list."],
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const {
    buildLinuxTaskGenerationView,
    linuxSanitizedRetryFeedback,
    linuxTaskGenerationApprovedPathAuthority,
    relationshipMappingsForTask,
    scanLinuxModelFacingPayload,
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const { cleanNarrativeField } = require(path.join(out, "linux", "narrativeResponse.js"));

  const view = baseView();
  const approved = linuxTaskGenerationApprovedPathAuthority(view);
  assert("approved /home simulated path scanner passes", scanLinuxModelFacingPayload(view, "view", { approvedAbsolutePaths: approved }).length === 0);
  assert("approved /home path remains visible", serializeLinuxTaskGenerationPrompt({ view }).includes("/home/alice/.ssh/authorized_keys"));

  const unknown = { ...view, learnerInstruction: "Unexpectedly inspect /home/unapproved/secret.txt" };
  const unknownIssues = scanLinuxModelFacingPayload(unknown, "unknown", { approvedAbsolutePaths: approved });
  assert("unknown /home path fails", unknownIssues.some((issue) => issue.category === "unapproved_absolute_path" && issue.token === "/home/unapproved/secret.txt"));
  assert("unknown /home diagnostic has field", unknownIssues.some((issue) => issue.field === "learnerInstruction" && /not_found_in_approved_path_authority/.test(issue.provenance || "")));

  assert("internal /home/oai path fails", scanLinuxModelFacingPayload("/home/oai/skills/private.txt", "internal", { approvedAbsolutePaths: ["/home/oai/skills/private.txt"] }).some((issue) => issue.category === "local_path"));
  assert("/mnt/data path fails", scanLinuxModelFacingPayload("/mnt/data/upload.txt", "internal").some((issue) => issue.category === "local_path"));
  assert("Windows developer path fails", scanLinuxModelFacingPayload("C:\\Users\\example\\Desktop\\cyberlab\\route.ts", "windows").some((issue) => issue.category === "local_path"));

  const punctuation = { ...view, allowedRelationshipStatements: [{ ...view.allowedRelationshipStatements[0], learnerStatement: "Evidence mentions /home/alice/.ssh/authorized_keys." }] };
  assert("approved path with prose punctuation passes", scanLinuxModelFacingPayload(punctuation, "punctuation", { approvedAbsolutePaths: linuxTaskGenerationApprovedPathAuthority(view) }).length === 0);
  assert("approved evidence-package path remains allowed", scanLinuxModelFacingPayload("Use assets/logs/auth.log only.", "asset path").length === 0);

  const unselected = { ...view, learnerObjective: "Do not expose /home/bob/.ssh/authorized_keys from another artifact." };
  assert("path from unselected artifact fails", scanLinuxModelFacingPayload(unselected, "unselected", { approvedAbsolutePaths: approved }).some((issue) => issue.category === "unapproved_absolute_path"));
  assert("relationship-path provenance passes", scanLinuxModelFacingPayload(view.allowedRelationshipStatements[0].learnerStatement, "relationship", { approvedAbsolutePaths: approved }).length === 0);

  const feedback = linuxSanitizedRetryFeedback(["path_scope"]);
  assert("retry feedback removes internal /home path", !feedback.includes("/home/oai/") && !feedback.includes("C:\\Users"));

  const malformed = cleanNarrativeField("Prepare a table of timestamp indexes supporting each '", "fallback");
  assert("cleanup removes orphan trailing quote", !/['"]$/.test(malformed), malformed);

  const seed = "prod-ssh-key-mail:phase9b:anyhome:0";
  const candidate = buildLinuxAssetCandidate({
          seed: seed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "CyberLab Asset Pack", seed }, { incidentFamily: "ssh_key_compromise" });
  const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const task = contract.taskContracts.find((item) =>
    relationshipMappingsForTask(item).some((mapping) => /\/home\/[^\s`"']+\/\.ssh\/authorized_keys/.test(mapping.learnerStatement))
  );
  assert("reproduced path-provenance task exists", Boolean(task));
  const mappings = relationshipMappingsForTask(task);
  const homePathMatch = mappings
    .map((item) => item.learnerStatement.match(/\/home\/[^\s`"']+\/\.ssh\/authorized_keys/)?.[0])
    .find(Boolean);
  const homeStatements = mappings.filter((item) => homePathMatch && item.learnerStatement.includes(homePathMatch));
  assert("task-local /home relationship statements reproduced", Boolean(homePathMatch) && homeStatements.length >= 3, JSON.stringify(homeStatements));
  const taskView = buildLinuxTaskGenerationView({ contract, task });
  const prompt = serializeLinuxTaskGenerationPrompt({ view: taskView });
  assert("production /home prompt passes scanner", scanLinuxModelFacingPayload(prompt, "production repro", {
    approvedAbsolutePaths: linuxTaskGenerationApprovedPathAuthority(taskView),
  }).length === 0);
  assert("production exact /home path remains visible", prompt.includes(homePathMatch));
}

main();
