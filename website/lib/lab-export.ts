import { createHash } from "crypto";
import { createZip } from "./zip";

export type SavedLabExportRecord = {
  id: string;
  title: string;
  topic: string;
  difficulty: string;
  estimated_time: string;
  objective: string;
  scenario: string;
  tasks: string[];
  hints: string[];
  outcomes: string[];
};

export type SavedLabExportAsset = {
  file_path: string;
  file_name: string;
  file_type?: string | null;
  content: string;
};

type ParsedTask = {
  phase: string;
  title: string;
  description: string;
  evidence: string[];
  deliverable: string;
};

export type EvidenceManifestEntry = {
  relativePath: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
};

export type EvidenceZipManifest = {
  manifestVersion: "amniora-evidence-export-manifest-v1";
  labId: string;
  labTitle: string;
  topic: string;
  difficulty: string;
  estimatedTime: string;
  exportIdentityHash: string;
  entries: EvidenceManifestEntry[];
};

export type EvidenceZipBuildResult = {
  zip: Buffer;
  manifest: EvidenceZipManifest;
  includedPaths: string[];
};

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 54;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_TOP = 734;
const PDF_BOTTOM = 58;
const PDF_FONT_SIZE = 9.5;
const PDF_HEADING_SIZE = 13;
const PDF_TITLE_SIZE = 20;
const PDF_LINE_HEIGHT = 12;
const MANIFEST_PATH = "EXPORT_MANIFEST.json";

function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(value: string) {
  return sha256Buffer(Buffer.from(value, "utf8"));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeZipPath(path: string) {
  const raw = String(path || "").replace(/\\/g, "/").trim();
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith("/") || raw.includes("\0")) {
    throw new Error(`Unsafe evidence path: ${raw || "(empty)"}`);
  }
  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) {
    throw new Error(`Unsafe evidence path traversal: ${raw}`);
  }
  const normalized = parts.filter((part) => part && part !== ".").join("/");
  if (!normalized) throw new Error("Evidence path is empty.");
  return normalized;
}

export function inferEvidenceMediaType(path: string, fileType?: string | null) {
  const value = `${path} ${fileType || ""}`.toLowerCase();
  if (value.endsWith(".csv") || value.includes("csv")) return "text/csv; charset=utf-8";
  if (value.endsWith(".json") || value.includes("json")) return "application/json; charset=utf-8";
  if (value.endsWith(".md") || value.includes("markdown")) return "text/markdown; charset=utf-8";
  if (value.endsWith(".log") || value.includes("log")) return "text/plain; charset=utf-8";
  if (value.endsWith(".txt") || value.includes("text")) return "text/plain; charset=utf-8";
  if (value.endsWith(".conf")) return "text/plain; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function parseSavedLabTask(task: string): ParsedTask {
  try {
    const parsed = JSON.parse(task) as {
      phase?: unknown;
      title?: unknown;
      description?: unknown;
      evidence?: unknown;
      deliverable?: unknown;
    };
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item) => String(item)).filter(Boolean)
      : typeof parsed.evidence === "string"
        ? parsed.evidence.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
        : [];
    return {
      phase: String(parsed.phase || "Task"),
      title: String(parsed.title || "Investigation task"),
      description: String(parsed.description || ""),
      evidence,
      deliverable: String(parsed.deliverable || ""),
    };
  } catch {
    return {
      phase: "Task",
      title: "Investigation task",
      description: task,
      evidence: [],
      deliverable: "",
    };
  }
}

function exportIdentityHash(lab: SavedLabExportRecord, assets: SavedLabExportAsset[]) {
  return sha256Text(stableJson({
    id: lab.id,
    title: lab.title,
    topic: lab.topic,
    difficulty: lab.difficulty,
    estimatedTime: lab.estimated_time,
    assetPaths: assets.map((asset) => normalizeZipPath(asset.file_path || asset.file_name)).sort(),
  }));
}

export function buildEvidenceZip(lab: SavedLabExportRecord, assets: SavedLabExportAsset[]): EvidenceZipBuildResult {
  const seen = new Set<string>();
  const normalizedAssets = assets
    .map((asset) => ({
      path: normalizeZipPath(asset.file_path || asset.file_name),
      content: String(asset.content || ""),
      fileType: asset.file_type,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const entries = normalizedAssets.map((asset) => {
    const lower = asset.path.toLowerCase();
    if (seen.has(lower)) throw new Error(`Duplicate evidence path: ${asset.path}`);
    seen.add(lower);
    const bytes = Buffer.from(asset.content, "utf8");
    return {
      relativePath: asset.path,
      byteLength: bytes.length,
      sha256: sha256Buffer(bytes),
      mediaType: inferEvidenceMediaType(asset.path, asset.fileType),
    };
  });

  const manifest: EvidenceZipManifest = {
    manifestVersion: "amniora-evidence-export-manifest-v1",
    labId: lab.id,
    labTitle: lab.title,
    topic: lab.topic,
    difficulty: lab.difficulty,
    estimatedTime: lab.estimated_time,
    exportIdentityHash: exportIdentityHash(lab, assets),
    entries,
  };
  const manifestContent = `${stableJson(manifest)}\n`;
  const zip = createZip([
    ...normalizedAssets.map((asset) => ({ path: asset.path, content: asset.content })),
    { path: MANIFEST_PATH, content: manifestContent },
  ]);
  return { zip, manifest, includedPaths: [...entries.map((entry) => entry.relativePath), MANIFEST_PATH] };
}

function pdfEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function sanitizePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function textWidth(value: string, fontSize: number) {
  return value.length * fontSize * 0.52;
}

function wrapText(value: string, maxWidth: number, fontSize: number) {
  const paragraphs = sanitizePdfText(value).split(/\n+/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (textWidth(word, fontSize) <= maxWidth) {
        current = word;
        continue;
      }
      let chunk = "";
      for (const char of word) {
        if (textWidth(`${chunk}${char}`, fontSize) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
    if (!words.length) lines.push("");
  }
  return lines;
}

type PdfLine = {
  text: string;
  fontSize: number;
  lineHeight: number;
  bold?: boolean;
  indent?: number;
  keepWithNext?: boolean;
  kind?: string;
};

type PdfBlock = {
  kind: string;
  lines: PdfLine[];
  splittable?: boolean;
  minFirstLines?: number;
  minLastLines?: number;
};

function headingLines(text: string, level: 1 | 2 | 3 = 2): PdfLine[] {
  const fontSize = level === 1 ? PDF_TITLE_SIZE : level === 2 ? PDF_HEADING_SIZE : 12;
  return wrapText(text, PDF_CONTENT_WIDTH, fontSize).map((line, index) => ({
    text: line,
    fontSize,
    lineHeight: fontSize + 6,
    bold: true,
    keepWithNext: true,
    kind: index === 0 ? "heading" : "heading_continuation",
  }));
}

function paragraph(text: string, options: { indent?: number; fontSize?: number } = {}): PdfLine[] {
  return wrapText(text, PDF_CONTENT_WIDTH - (options.indent || 0), options.fontSize || PDF_FONT_SIZE).map((line) => ({
    text: line,
    fontSize: options.fontSize || PDF_FONT_SIZE,
    lineHeight: PDF_LINE_HEIGHT,
    indent: options.indent,
    kind: "text",
  }));
}

function bullet(text: string) {
  return paragraph(`- ${text}`, { indent: 12 });
}

function spacer(height = 5): PdfLine {
  return { text: "", fontSize: PDF_FONT_SIZE, lineHeight: height, kind: "spacer" };
}

function block(kind: string, lines: PdfLine[], options: Omit<PdfBlock, "kind" | "lines"> = {}): PdfBlock {
  return { kind, lines: [spacer(), ...lines], ...options };
}

function blockHeight(blockValue: PdfBlock) {
  return blockValue.lines.reduce((total, line) => total + line.lineHeight, 0);
}

function lineHeight(lines: PdfLine[]) {
  return lines.reduce((total, line) => total + line.lineHeight, 0);
}

function splitBlockForPage(blockValue: PdfBlock, remainingHeight: number): [PdfBlock | null, PdfBlock | null] {
  if (!blockValue.splittable || blockHeight(blockValue) <= remainingHeight) return [null, blockValue];
  const minFirst = blockValue.minFirstLines ?? 3;
  const minLast = blockValue.minLastLines ?? 2;
  let used = 0;
  let splitIndex = 0;
  for (let index = 0; index < blockValue.lines.length; index += 1) {
    const next = used + blockValue.lines[index].lineHeight;
    if (next > remainingHeight) break;
    used = next;
    splitIndex = index + 1;
  }
  if (splitIndex < minFirst || blockValue.lines.length - splitIndex < minLast) return [null, blockValue];
  return [
    { ...blockValue, lines: blockValue.lines.slice(0, splitIndex), splittable: false },
    { ...blockValue, lines: blockValue.lines.slice(splitIndex), splittable: true },
  ];
}

function paginateBlocks(blocks: PdfBlock[]) {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let remaining = PDF_TOP - PDF_BOTTOM;

  const pushPage = () => {
    if (current.some((line) => line.text.trim())) pages.push(current);
    current = [];
    remaining = PDF_TOP - PDF_BOTTOM;
  };

  const addLines = (lines: PdfLine[]) => {
    current.push(...lines);
    remaining -= lineHeight(lines);
  };

  for (const sourceBlock of blocks) {
    let pending: PdfBlock | null = sourceBlock;
    while (pending) {
      const height = blockHeight(pending);
      if (height <= remaining) {
        addLines(pending.lines);
        pending = null;
        continue;
      }
      const [head, tail] = splitBlockForPage(pending, remaining);
      if (head && tail) {
        addLines(head.lines);
        pushPage();
        pending = tail;
        continue;
      }
      if (current.length > 0) {
        pushPage();
        continue;
      }
      const forcedLines: PdfLine[] = [];
      let used = 0;
      for (const line of pending.lines) {
        if (used + line.lineHeight > remaining && forcedLines.length > 0) break;
        forcedLines.push(line);
        used += line.lineHeight;
      }
      addLines(forcedLines);
      pending = { ...pending, lines: pending.lines.slice(forcedLines.length) };
      pushPage();
    }
  }
  pushPage();
  while (pages.length > 1) {
    const finalPage = pages[pages.length - 1];
    const finalTextLength = finalPage.reduce((total, line) => total + line.text.replace(/\s+/g, "").length, 0);
    if (finalTextLength >= 900) break;
    const previousPage = pages[pages.length - 2];
    const movableIndex = previousPage
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => index > 0 && line.kind === "heading" && line.text.trim())
      .map(({ index }) => index)
      .pop();
    if (movableIndex === undefined) break;
    const movable = previousPage.splice(movableIndex);
    const previousTextLength = previousPage.reduce((total, line) => total + line.text.replace(/\s+/g, "").length, 0);
    if (previousTextLength < 360) {
      previousPage.push(...movable);
      break;
    }
    pages[pages.length - 1] = [...movable, ...finalPage];
  }
  return pages;
}

export function buildLabPdf(lab: SavedLabExportRecord, assets: SavedLabExportAsset[]): Buffer {
  const tasks = lab.tasks.map(parseSavedLabTask);
  const blocks: PdfBlock[] = [
    block("document_heading", [
      ...headingLines(lab.title, 1),
      ...paragraph(`${lab.topic} - ${lab.difficulty} - ${lab.estimated_time}`),
    ]),
    block("objective", [...headingLines("Objective"), ...paragraph(lab.objective)]),
    block("scenario", [...headingLines("Scenario"), ...paragraph(lab.scenario)]),
    block("tasks_heading", [...headingLines(`Tasks (${tasks.length})`)]),
  ];

  tasks.forEach((task, index) => {
    const descriptionLines = task.description.trim() ? paragraph(task.description) : [];
    const taskLines = [...headingLines(`Task ${index + 1}: ${task.title}`, 3), ...descriptionLines];
    taskLines.push(...paragraph(`Deliverable: ${task.deliverable}`));
    if (task.evidence.length) {
      taskLines.push(...paragraph(`Evidence references: ${task.evidence.join("; ")}`));
    }
    blocks.push(block("task", taskLines, { splittable: false }));
  });

  blocks.push(block("hints", [...headingLines("Hints"), ...lab.hints.flatMap((hintText) => bullet(hintText))], { splittable: true, minFirstLines: 3, minLastLines: 2 }));
  blocks.push(block("learning_outcomes", [...headingLines("Learning Outcomes"), ...lab.outcomes.flatMap((outcome) => bullet(outcome))], { splittable: true, minFirstLines: 3, minLastLines: 2 }));
  const inventoryPaths = assets
    .map((asset) => normalizeZipPath(asset.file_path || asset.file_name))
    .sort();
  blocks.push(block("evidence_inventory", [...headingLines(`Evidence Inventory (${assets.length})`), ...paragraph(inventoryPaths.join("; "))], { splittable: false }));

  const pages = paginateBlocks(blocks);

  const objects: Buffer[] = [];
  const addObject = (body: string | Buffer) => {
    const content = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    objects.push(content);
    return objects.length;
  };
  const pageObjectIds: number[] = [];
  const regularFontObjectId = 3;
  const boldFontObjectId = 4;

  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  pages.forEach((pageLines, pageIndex) => {
    let cursorY = PDF_TOP;
    const commands = pageLines.map((line) => {
      const x = PDF_MARGIN + (line.indent || 0);
      cursorY -= line.lineHeight;
      const font = line.bold ? "F2" : "F1";
      return `BT /${font} ${line.fontSize} Tf ${x.toFixed(2)} ${cursorY.toFixed(2)} Td (${pdfEscape(line.text)}) Tj ET`;
    });
    commands.push(`BT /F1 9 Tf ${PDF_MARGIN.toFixed(2)} 32 Td (Page ${pageIndex + 1} of ${pages.length}) Tj ET`);
    const stream = Buffer.from(commands.join("\n"), "utf8");
    const contentId = addObject(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "utf8"),
      stream,
      Buffer.from("\nendstream", "utf8"),
    ]));
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularFontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageObjectIds.push(pageId);
  });

  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`, "utf8");
  const infoId = addObject(`<< /Title (${pdfEscape(lab.title)}) /Subject (${pdfEscape(`${lab.topic} ${lab.difficulty}`)}) /Creator (Amniora) /Producer (Amniora native text export) >>`);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "utf8"), object, Buffer.from("\nendobj\n", "utf8"));
  });
  const xrefOffset = Buffer.concat(chunks).length;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n");
  chunks.push(Buffer.from(xref, "utf8"));
  return Buffer.concat(chunks);
}

export function extractPdfTextForValidation(pdf: Buffer) {
  const content = pdf.toString("latin1");
  const matches = [...content.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)];
  return matches
    .map((match) => match[0].replace(/\)\s*Tj$/, "").slice(1).replace(/\\([\\()])/g, "$1"))
    .join("\n");
}

export function exportedPdfPageCount(pdf: Buffer) {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
}

export type PdfLayoutLineMetric = {
  page: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  estimatedWidth: number;
};

export type PdfPageDensityMetric = {
  page: number;
  contentLineCount: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  nonWhitespaceTextLength: number;
  permittedShortFinalPage: boolean;
};

export function analyzePdfLayoutForValidation(pdf: Buffer) {
  const content = pdf.toString("latin1");
  const pageStreams = [...content.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((match) => match[1]);
  const lines: PdfLayoutLineMetric[] = [];
  pageStreams.forEach((stream, pageIndex) => {
    const matches = [...stream.matchAll(/BT\s+\/F[12]\s+([0-9.]+)\s+Tf\s+([0-9.]+)\s+([0-9.]+)\s+Td\s+\(((?:\\.|[^\\)])*)\)\s+Tj\s+ET/g)];
    matches.forEach((match) => {
      const text = match[4].replace(/\\([\\()])/g, "$1");
      const fontSize = Number(match[1]);
      const x = Number(match[2]);
      const y = Number(match[3]);
      lines.push({
        page: pageIndex + 1,
        text,
        x,
        y,
        fontSize,
        estimatedWidth: textWidth(text, fontSize),
      });
    });
  });
  const pageCount = exportedPdfPageCount(pdf);
  const pages: PdfPageDensityMetric[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const pageLines = lines.filter((line) => line.page === page && line.text.trim() && !/^Page \d+ of \d+$/.test(line.text));
    const nonWhitespaceTextLength = pageLines.reduce((total, line) => total + line.text.replace(/\s+/g, "").length, 0);
    pages.push({
      page,
      contentLineCount: pageLines.length,
      minX: pageLines.length ? Math.min(...pageLines.map((line) => line.x)) : 0,
      maxX: pageLines.length ? Math.max(...pageLines.map((line) => line.x + line.estimatedWidth)) : 0,
      minY: pageLines.length ? Math.min(...pageLines.map((line) => line.y)) : 0,
      maxY: pageLines.length ? Math.max(...pageLines.map((line) => line.y)) : 0,
      nonWhitespaceTextLength,
      permittedShortFinalPage: page === pageCount && nonWhitespaceTextLength >= 120 && pageLines.length >= 3,
    });
  }
  return { lines, pages };
}

export function evidenceManifestPath() {
  return MANIFEST_PATH;
}

export function validateLabExportConsistency(input: {
  lab: SavedLabExportRecord;
  pdf: Buffer;
  manifest: EvidenceZipManifest;
  assets: SavedLabExportAsset[];
}) {
  const issues: string[] = [];
  const pdfText = extractPdfTextForValidation(input.pdf);
  const assetPaths = input.assets.map((asset) => normalizeZipPath(asset.file_path || asset.file_name)).sort();
  const manifestPaths = input.manifest.entries.map((entry) => entry.relativePath).sort();
  if (input.manifest.labId !== input.lab.id) issues.push("manifest_lab_id_mismatch");
  if (input.manifest.labTitle !== input.lab.title) issues.push("manifest_title_mismatch");
  if (input.manifest.exportIdentityHash !== exportIdentityHash(input.lab, input.assets)) issues.push("export_identity_hash_mismatch");
  const normalizedPdfText = pdfText.replace(/\s+/g, " ").trim();
  const normalizedTitle = input.lab.title.replace(/\s+/g, " ").trim();
  if (!normalizedPdfText.includes(normalizedTitle)) issues.push("pdf_title_mismatch");
  for (const path of assetPaths) {
    if (!manifestPaths.includes(path)) issues.push(`manifest_missing:${path}`);
    if (!pdfText.includes(path)) issues.push(`pdf_missing_evidence:${path}`);
  }
  for (const path of manifestPaths) {
    if (!assetPaths.includes(path)) issues.push(`manifest_unexpected:${path}`);
  }
  const taskEvidence = input.lab.tasks.flatMap((task) => parseSavedLabTask(task).evidence);
  for (const path of taskEvidence) {
    const normalized = normalizeZipPath(path);
    if (!manifestPaths.includes(normalized)) issues.push(`task_evidence_missing_from_zip:${normalized}`);
  }
  return { passed: issues.length === 0, issues };
}
