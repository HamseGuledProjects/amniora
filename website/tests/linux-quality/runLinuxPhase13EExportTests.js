// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

function ensureOut() {
  if (process.env.OUT) return process.env.OUT;
  const out = path.join(process.env.TEMP || ".tmp", `amniora-phase13e-export-${Date.now()}`);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execSync(`${npx} tsc --outDir "${out}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, { stdio: "inherit" });
  process.env.OUT = path.join(out, "lib", "lab-assets");
  return process.env.OUT;
}

const outRoot = ensureOut();
const exportLib = require(path.join(outRoot, "..", "lab-export.js"));

const {
  analyzePdfLayoutForValidation,
  buildEvidenceZip,
  buildLabPdf,
  evidenceManifestPath,
  exportedPdfPageCount,
  extractPdfTextForValidation,
  validateLabExportConsistency,
} = exportLib;

const outputDir = path.join(".tmp", "phase13e-export");
const renderedDir = path.join(outputDir, "rendered");
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(renderedDir, { recursive: true });
const popplerBin = process.env.POPPLER_BIN || "";
const PDFTOPPM = popplerBin ? path.join(popplerBin, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm") : "pdftoppm";
const PDFINFO = popplerBin ? path.join(popplerBin, process.platform === "win32" ? "pdfinfo.exe" : "pdfinfo") : "pdfinfo";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function task({ phase, title, description, evidence, deliverable }) {
  return JSON.stringify({ phase, title, description, evidence, deliverable });
}

function labShape(id, title, difficulty, role, family, taskOverrides = []) {
  const baseTasks = [
    task({
      phase: "Review",
      title: `Review ${role} evidence baseline`,
      description: `Compare the supplied ${role} records and identify the evidence-supported ${family} question without using unstated assumptions.`,
      evidence: ["assets/evidence/incident_brief.md", "assets/evidence/timeline.csv"],
      deliverable: "Write one evidence-supported summary that cites the relevant timeline and brief entries.",
    }),
    task({
      phase: "Correlate",
      title: "Correlate task-local evidence",
      description: "Use only the listed evidence files to map observed facts, supported inference, and remaining uncertainty.",
      evidence: ["assets/logs/auth.log", "assets/logs/audit.log"],
      deliverable: "Provide the observed timestamp, actor, activity, and one limitation the evidence cannot prove.",
    }),
    task({
      phase: "Report",
      title: "Prepare the learner-facing conclusion",
      description: "Summarize containment and validation steps that are supported by the supplied offline evidence.",
      evidence: ["assets/evidence/remediation_plan.md"],
      deliverable: "List containment, remediation, and validation actions without claiming completion or attacker intent.",
    }),
  ];
  return {
    id,
    title,
    topic: "Linux",
    difficulty,
    estimated_time: difficulty === "Advanced" ? "60 mins" : "30 mins",
    objective: `Investigate a ${family} report for ${role} using only the saved learner-facing evidence.`,
    scenario: `${role} is under review after a private-beta Linux investigation generated deterministic evidence for ${family}.`,
    tasks: taskOverrides.length ? taskOverrides : baseTasks,
    hints: [
      "Start with the task-local evidence list and avoid using unrelated files.",
      "Separate observed facts from supported inference before writing a conclusion.",
      "Mention evidence gaps when the supplied files cannot prove a relationship.",
    ],
    outcomes: [
      "Correlate Linux evidence without relying on hidden internal identifiers.",
      "Explain uncertainty boundaries using learner-visible records.",
      "Prepare safe remediation requirements without exposing an answer key.",
    ],
  };
}

function assetsFor(role, extra = []) {
  return [
    {
      file_path: "assets/evidence/incident_brief.md",
      file_name: "incident_brief.md",
      file_type: "markdown",
      content: `# Incident brief\nHost role: ${role}\nUse this brief as context, not as proof of execution.\n`,
    },
    {
      file_path: "assets/evidence/timeline.csv",
      file_name: "timeline.csv",
      file_type: "csv",
      content: "timestamp,event,evidence\n2026-07-06T03:08:00Z,review opened,incident_brief.md\n",
    },
    {
      file_path: "assets/logs/auth.log",
      file_name: "auth.log",
      file_type: "log",
      content: "Jul 06 03:08:15 host sshd[4210]: Accepted publickey for analyst from 192.0.2.10 port 51822 ssh2\n",
    },
    {
      file_path: "assets/logs/audit.log",
      file_name: "audit.log",
      file_type: "log",
      content: "type=EXECVE msg=audit(1783307300.123:44): argc=2 a0=\"systemctl\" a1=\"status\"\n",
    },
    {
      file_path: "assets/evidence/remediation_plan.md",
      file_name: "remediation_plan.md",
      file_type: "markdown",
      content: "# Remediation planning\nContainment and validation must be evidence-supported.\n",
    },
    ...extra,
  ];
}

function parseZip(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const contentStart = offset + 30 + nameLength + extraLength;
    const content = buffer.subarray(contentStart, contentStart + compressedSize);
    entries.push({ name, content, compressedSize, uncompressedSize });
    offset = contentStart + compressedSize;
  }
  return entries;
}

function assertNoInternalLeak(text) {
  const forbidden = /(capability_key|subject_indexes|canonical|assessmentContract|OPENAI_API_KEY|Authorization|raw prompt|model response)/i;
  assert(!forbidden.test(text), "export text leaked internal contract material");
}

function includesNormalized(text, expected) {
  const normalize = (value) => String(value).replace(/\s+/g, " ").trim();
  return normalize(text).includes(normalize(expected));
}

function sourceLearnerText(lab, assets) {
  const taskTexts = lab.tasks.flatMap((item) => {
    const parsed = JSON.parse(item);
    return [parsed.title, parsed.description, parsed.deliverable, ...(parsed.evidence || [])];
  });
  return [
    lab.title,
    lab.topic,
    lab.difficulty,
    lab.estimated_time,
    lab.objective,
    lab.scenario,
    ...taskTexts,
    ...lab.hints,
    ...lab.outcomes,
    ...assets.map((asset) => asset.file_path),
  ].join(" ");
}

function normalizedWords(value) {
  return String(value).replace(/[^A-Za-z0-9/_:.-]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function renderPdf(label, pdfPath) {
  assert(fs.existsSync(PDFINFO), "bundled pdfinfo exists");
  assert(fs.existsSync(PDFTOPPM), "bundled pdftoppm exists");
  const info = execSync(`"${PDFINFO}" "${pdfPath}"`, { encoding: "utf8" });
  assert(/Pages:\s+\d+/i.test(info), `${label} pdfinfo reports pages`);
  const prefix = path.join(renderedDir, label);
  execSync(`"${PDFTOPPM}" -png -r 110 "${pdfPath}" "${prefix}"`, { stdio: "ignore" });
  const rendered = fs.readdirSync(renderedDir)
    .filter((name) => name.startsWith(`${label}-`) && name.endsWith(".png"))
    .map((name) => path.join(renderedDir, name))
    .sort();
  assert(rendered.length > 0, `${label} rendered PNG pages exist`);
  rendered.forEach((png) => assert(fs.statSync(png).size > 1000, `${label} ${path.basename(png)} rendered non-empty`));
  return { info, rendered };
}

function assertLayout(label, pdf, expectedPageCount) {
  const { lines, pages } = analyzePdfLayoutForValidation(pdf);
  assert.strictEqual(pages.length, expectedPageCount, `${label} layout page count matches PDF page count`);
  pages.forEach((page, index) => {
    assert(page.contentLineCount >= 6 || page.permittedShortFinalPage, `${label} page ${page.page} has meaningful line density`);
    assert(page.nonWhitespaceTextLength >= 180 || page.permittedShortFinalPage, `${label} page ${page.page} has meaningful text density`);
    assert(page.minX >= 53.5, `${label} page ${page.page} starts within left margin`);
    assert(page.maxX <= 558.5, `${label} page ${page.page} ends within right margin`);
    assert(page.minY >= 52, `${label} page ${page.page} baseline above bottom boundary`);
    assert(page.maxY <= 736, `${label} page ${page.page} baseline below top boundary`);
    const pageText = lines.filter((line) => line.page === page.page).map((line) => line.text).join("\n");
    assert(!/^Evidence Inventory[^\n]*(?:\n-? ?assets\/[^\n]+){1,2}\s*Page \d+ of \d+$/i.test(pageText.trim()), `${label} page ${page.page} is not orphaned inventory spillover`);
    if (index === pages.length - 1 && pages.length > 1) {
      assert(page.nonWhitespaceTextLength >= 700, `${label} final page is not nearly blank`);
    }
  });
  for (const line of lines) {
    assert(line.x >= 0 && line.x <= 612, `${label} text object x inside media box`);
    assert(line.y >= 0 && line.y <= 792, `${label} text object y inside media box`);
    assert(line.x + line.estimatedWidth <= 612, `${label} text object width inside media box`);
  }
  const byPage = new Map();
  lines.filter((line) => line.text.trim()).forEach((line) => {
    const key = line.page;
    const bucket = byPage.get(key) || [];
    bucket.push(line);
    byPage.set(key, bucket);
  });
  for (const [page, pageLines] of byPage) {
    const baselines = pageLines.map((line) => line.y).sort((a, b) => b - a);
    for (let index = 1; index < baselines.length; index += 1) {
      assert(Math.abs(baselines[index - 1] - baselines[index]) >= 6 || baselines[index] === 32, `${label} page ${page} has no overlapping text baselines`);
    }
  }
  return pages;
}

function validateShape(lab, assets, label) {
  const pdf = buildLabPdf(lab, assets);
  const pdfText = extractPdfTextForValidation(pdf);
  const pageCount = exportedPdfPageCount(pdf);
  const zipResult = buildEvidenceZip(lab, assets);
  const entries = parseZip(zipResult.zip);
  const manifestEntry = entries.find((entry) => entry.name === evidenceManifestPath());
  assert(manifestEntry, `${label} manifest exists`);
  const manifest = JSON.parse(manifestEntry.content.toString("utf8"));
  const evidenceEntries = entries.filter((entry) => entry.name !== evidenceManifestPath());
  const entryNames = evidenceEntries.map((entry) => entry.name);

  assert(pageCount > 0, `${label} has at least one PDF page`);
  assert(pdfText.length > 500, `${label} extracted text is meaningful`);
  assert(includesNormalized(pdfText, lab.title), `${label} title searchable`);
  assert(includesNormalized(pdfText, lab.objective), `${label} objective searchable`);
  assert(includesNormalized(pdfText, lab.scenario), `${label} scenario searchable`);
  assert(pdfText.includes("Learning Outcomes"), `${label} outcomes heading searchable`);
  assert(pdfText.includes("Evidence Inventory"), `${label} evidence inventory searchable`);
  lab.tasks.map(JSON.parse).forEach((parsedTask, index) => {
    assert(includesNormalized(pdfText, parsedTask.title), `${label} task ${index + 1} title searchable`);
    assert(includesNormalized(pdfText, parsedTask.deliverable), `${label} task ${index + 1} deliverable searchable`);
    parsedTask.evidence.forEach((evidencePath) => assert(includesNormalized(pdfText, evidencePath), `${label} evidence path searchable ${evidencePath}`));
  });
  lab.hints.forEach((hint) => assert(includesNormalized(pdfText, hint), `${label} hint searchable`));
  lab.outcomes.forEach((outcome) => assert(includesNormalized(pdfText, outcome), `${label} outcome searchable`));
  assertNoInternalLeak(pdfText);
  assertNoInternalLeak(manifestEntry.content.toString("utf8"));
  for (const word of normalizedWords(sourceLearnerText(lab, assets))) {
    if (word.length > 5 || word.includes("/") || word.includes(":")) {
      assert(includesNormalized(pdfText, word), `${label} source token survives PDF extraction: ${word}`);
    }
  }

  assert.strictEqual(manifest.entries.length, assets.length, `${label} manifest covers every evidence file`);
  assert.deepStrictEqual(manifest.entries.map((entry) => entry.relativePath).sort(), entryNames.sort(), `${label} manifest inventory matches ZIP`);
  for (const entry of evidenceEntries) {
    const manifestRecord = manifest.entries.find((candidate) => candidate.relativePath === entry.name);
    assert(manifestRecord, `${label} ${entry.name} has manifest record`);
    assert.strictEqual(manifestRecord.byteLength, entry.content.length, `${label} ${entry.name} byte length matches`);
    assert.strictEqual(manifestRecord.sha256, sha256(entry.content), `${label} ${entry.name} sha256 matches`);
    assert(manifestRecord.mediaType, `${label} ${entry.name} media type declared`);
    assert(!path.isAbsolute(entry.name), `${label} ${entry.name} not absolute`);
    assert(!entry.name.split("/").includes(".."), `${label} ${entry.name} no traversal`);
  }
  const lowerNames = entryNames.map((name) => name.toLowerCase());
  assert.strictEqual(lowerNames.length, new Set(lowerNames).size, `${label} no case-insensitive collisions`);
  assert(validateLabExportConsistency({ lab, pdf, manifest, assets }).passed, `${label} PDF and ZIP share export identity`);

  const secondPdf = buildLabPdf(lab, assets);
  const secondZip = buildEvidenceZip(lab, assets);
  assert.strictEqual(sha256(pdf), sha256(secondPdf), `${label} PDF deterministic`);
  assert.strictEqual(sha256(zipResult.zip), sha256(secondZip.zip), `${label} ZIP deterministic`);

  fs.writeFileSync(path.join(outputDir, `${label}.pdf`), pdf);
  fs.writeFileSync(path.join(outputDir, `${label}.zip`), zipResult.zip);
  const pdfPath = path.join(outputDir, `${label}.pdf`);
  const pageMetrics = assertLayout(label, pdf, pageCount);
  const rendered = renderPdf(label, pdfPath);
  const titleLineCount = analyzePdfLayoutForValidation(pdf).lines.filter((line) => line.fontSize === 20).length;
  return { pageCount, textLength: pdfText.length, manifestHash: sha256(manifestEntry.content), pageMetrics, titleLineCount, renderedPngs: rendered.rendered };
}

const productionShapes = [
  ["administrative-jump-host-beginner", labShape("phase13e-beginner", "Administrative Jump Host Review", "Beginner", "administrative jump host", "systemd baseline"), assetsFor("administrative jump host")],
  ["kubernetes-worker-intermediate", labShape("phase13e-intermediate", "Kubernetes Worker Evidence Review", "Intermediate", "Kubernetes worker", "platform-sync persistence"), assetsFor("Kubernetes worker", [
    {
      file_path: "assets/scripts/platform-sync.sh",
      file_name: "platform-sync.sh",
      file_type: "text",
      content: "#!/bin/sh\n/usr/local/bin/platform-sync --status\n",
    },
  ])],
  ["mail-relay-cron-advanced", labShape("phase13e-advanced", "Mail Relay Cron Persistence Review", "Advanced", "mail relay", "cron persistence", [
    task({
      phase: "Define",
      title: "Review the cron definition and approval scope",
      description: "Compare the cron definition, scheduled script, and change authority to determine whether the approved scope matches the expected scheduled operation.",
      evidence: ["assets/evidence/incident_brief.md", "assets/cron.d/mail-relay", "assets/scripts/mail-relay-sync.sh"],
      deliverable: "Explain whether the cron definition is approved, unresolved, or outside the supplied authority window, citing the exact learner-visible files.",
    }),
    task({
      phase: "Correlate",
      title: "Correlate cron execution evidence",
      description: "Use timestamped cron and audit evidence to distinguish historical execution from current scheduled state.",
      evidence: ["assets/logs/audit.log", "assets/evidence/timeline.csv"],
      deliverable: "Report the observed execution evidence and state what the current cron definition cannot prove about historical execution.",
    }),
  ]), assetsFor("mail relay", [
    {
      file_path: "assets/cron.d/mail-relay",
      file_name: "mail-relay",
      file_type: "text",
      content: "*/5 * * * * relay /usr/local/sbin/mail-relay-sync.sh\n",
    },
    {
      file_path: "assets/scripts/mail-relay-sync.sh",
      file_name: "mail-relay-sync.sh",
      file_type: "text",
      content: "#!/bin/sh\n/usr/local/sbin/mail-relay-sync --flush\n",
    },
  ])],
];

const results = productionShapes.map(([label, lab, assets]) => validateShape(lab, assets, label));

const longTask = task({
  phase: "Correlate",
  title: "Correlate long command and path evidence without clipping",
  description: "Review the long command /usr/local/sbin/mail-relay-sync --flush --window 2026-07-06T03:08:00Z --config /etc/mail/relay/very-long-configuration-path-with-readable-wrapping.conf and preserve the full path while wrapping text naturally across pages.",
  evidence: ["assets/logs/audit.log", "assets/scripts/mail-relay-sync.sh", "assets/evidence/timeline.csv"],
  deliverable: "Write a concise explanation that includes the complete command path /usr/local/sbin/mail-relay-sync and does not truncate command output for /usr/local/sbin/mail-relay-sync.",
});
const longLab = labShape("phase13e-long", "Intermediate Linux Authentication and Privileged Session Evidence Correlation Review Across the Declared Investigation Window", "Intermediate", "mail relay", "cron persistence", Array.from({ length: 14 }, (_, index) => longTask.replace("Correlate long", `Correlate long ${index + 1}`)));
const longResult = validateShape(longLab, assetsFor("mail relay", [
  {
    file_path: "assets/scripts/mail-relay-sync.sh",
    file_name: "mail-relay-sync.sh",
    file_type: "text",
    content: "#!/bin/sh\n/usr/local/sbin/mail-relay-sync --flush --window 2026-07-06T03:08:00Z\n",
  },
]), "long-multipage");
assert(longResult.pageCount > 1, "long export spans multiple pages");
assert(longResult.titleLineCount > 1, "long Intermediate title wraps onto multiple lines");

assert.throws(() => buildEvidenceZip(productionShapes[0][1], [
  ...productionShapes[0][2],
  { file_path: "../secret.txt", file_name: "secret.txt", file_type: "text", content: "nope" },
]), /Unsafe evidence path traversal/, "ZIP traversal rejected");
assert.throws(() => buildEvidenceZip(productionShapes[0][1], [
  ...productionShapes[0][2],
  { file_path: "C:/Users/example/secret.txt", file_name: "secret.txt", file_type: "text", content: "nope" },
]), /Unsafe evidence path/, "ZIP absolute path rejected");
assert.throws(() => buildEvidenceZip(productionShapes[0][1], [
  ...productionShapes[0][2],
  { file_path: "assets/logs/AUTH.LOG", file_name: "AUTH.LOG", file_type: "log", content: "collision" },
]), /Duplicate evidence path/, "ZIP case-insensitive duplicate rejected");

const mismatchPdf = buildLabPdf(productionShapes[0][1], productionShapes[0][2]);
const mismatchZip = buildEvidenceZip(productionShapes[1][1], productionShapes[1][2]);
assert(!validateLabExportConsistency({
  lab: productionShapes[0][1],
  pdf: mismatchPdf,
  manifest: mismatchZip.manifest,
  assets: productionShapes[0][2],
}).passed, "cross-lab PDF/ZIP mismatch rejected");

const matrixDifficulties = ["Beginner", "Intermediate", "Advanced"];
const families = [
  "ssh_bruteforce",
  "ssh_key_compromise",
  "misconfigured_sudoers",
  "service_account_misuse",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];
let matrixCases = 0;
for (const family of families) {
  for (const difficulty of matrixDifficulties) {
    const lab = labShape(`phase13e-${family}-${difficulty}`, `${family} ${difficulty} Export`, difficulty, "application server", family);
    const assets = assetsFor("application server");
    const pdf = buildLabPdf(lab, assets);
    const zip = buildEvidenceZip(lab, assets);
    const consistency = validateLabExportConsistency({ lab, pdf, manifest: zip.manifest, assets });
    assert(consistency.passed, `${family} ${difficulty} export preflight consistent`);
    assert(extractPdfTextForValidation(pdf).includes(family), `${family} ${difficulty} semantic text present`);
    matrixCases += 1;
  }
}

console.log(JSON.stringify({
  passed: true,
  productionShapes: results,
  longPageCount: longResult.pageCount,
  matrixCases,
  outputDir,
}, null, 2));
