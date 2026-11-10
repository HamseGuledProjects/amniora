import type { AIModel } from "./config";
import type { LabAsset } from "@/lib/lab-assets/types";
import { fetchOpenAI } from "./openaiFetch";

export type AIQualityIssue = {
  severity: "low" | "medium" | "high";
  category: string;
  description: string;
};

export type AIQualityReviewResult = {
  score: number;
  decision: "PASS" | "FAIL";
  issues: AIQualityIssue[];
  summary: string;
};

export type QualityReviewTask = {
  phase: string;
  title: string;
  evidence: string[];
  deliverable: string;
};

export type QualityReviewLab = {
  title: string;
  topic: string;
  difficulty: string;
  estimated_time: string;
  objective: string;
  scenario: string;
  tasks: QualityReviewTask[];
  hints: string[];
  outcomes: string[];
};

export type QualityReviewInput = {
  category: string;
  difficulty: string;
  duration: string;
  model: AIModel;
  lab: QualityReviewLab;
  assets: LabAsset[];
  validatorSummary: string;
};

const MAX_SNIPPET_CHARS = 1600;

function assetByPath(assets: LabAsset[], path: string) {
  return assets.find((asset) => asset.file_path === path);
}

function firstMatchingAsset(assets: LabAsset[], patterns: RegExp[]) {
  return assets.find((asset) =>
    patterns.some((pattern) => pattern.test(asset.file_path))
  );
}

function snippet(asset: LabAsset | undefined, maxLines = 18) {
  if (!asset) return null;

  const lines = asset.content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines)
    .join("\n");

  return {
    path: asset.file_path,
    content:
      lines.length > MAX_SNIPPET_CHARS
        ? `${lines.slice(0, MAX_SNIPPET_CHARS)}\n[truncated]`
        : lines,
  };
}

function parseJsonAsset(asset: LabAsset | undefined) {
  if (!asset) return null;

  try {
    return JSON.parse(asset.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function incidentIndicators(assets: LabAsset[]) {
  const joined = assets
    .map((asset) => `${asset.file_path}\n${asset.content.slice(0, 1200)}`)
    .join("\n")
    .toLowerCase();
  const indicators = [
    ["ssh authentication", /\bsshd\b|authorized_keys|publickey|failed password/],
    ["sudo or privilege policy", /sudoers|command=\/usr\/bin\/cat \/etc\/shadow|sudo\.log/],
    ["service account shell use", /service account|interactive.*service|backup-agent/],
    ["cron persistence", /\/etc\/cron\.d|crontab|cron\[/],
    ["systemd unit change", /metrics-cache\.service|systemctl enable|\/etc\/systemd\/system/],
    ["package-management activity", /apt_history|apt install|\/var\/lib\/dpkg|ncat/],
    ["data staging", /\/tmp\/.*bundle|\/tmp\/export|tar -czf|rsync -av/],
    ["log integrity", /truncate -s 0|logrotate -f|auth\.log\.1/],
    ["web process or reverse shell", /\/dev\/tcp|apache2|\/var\/www/],
    ["container runtime", /docker\.sock|docker run|portal-worker|containerd/],
  ] as const;

  return indicators
    .filter(([, pattern]) => pattern.test(joined))
    .map(([label]) => label)
    .slice(0, 4);
}

function compactDocumentation(assets: LabAsset[]) {
  return [
    snippet(assetByPath(assets, "assets/evidence/incident_brief.md"), 22),
    snippet(assetByPath(assets, "assets/evidence/audit_notes.md"), 16),
    snippet(assetByPath(assets, "assets/evidence/analyst_working_notes.md"), 16),
  ].filter(Boolean);
}

function compactReviewPayload(input: QualityReviewInput) {
  const { assets, lab } = input;
  const hostMetadata = parseJsonAsset(
    assetByPath(assets, "assets/inventory/host_metadata.json")
  );
  const evidenceFiles = assets
    .filter((asset) => asset.file_path.startsWith("assets/"))
    .map((asset) => asset.file_path);

  return {
    metadata: {
      category: input.category,
      difficulty: input.difficulty,
      duration: input.duration,
      validatorSummary: input.validatorSummary,
      assetCount: assets.length,
      hostRole: hostMetadata?.role || null,
      hostname: hostMetadata?.hostname || null,
      industry: hostMetadata?.industry || null,
      incidentIndicators: incidentIndicators(assets),
      evidenceFiles,
    },
    generatedLab: {
      title: lab.title,
      topic: lab.topic,
      difficulty: lab.difficulty,
      estimated_time: lab.estimated_time,
      objective: lab.objective,
      scenario: lab.scenario,
      tasks: lab.tasks,
      hints: lab.hints,
      outcomes: lab.outcomes,
    },
    evidenceContext: {
      timeline: snippet(assetByPath(assets, "assets/evidence/timeline.csv"), 14),
      documentation: compactDocumentation(assets),
      serviceInventory: snippet(
        assetByPath(assets, "assets/reports/service_inventory.txt"),
        22
      ),
      users: snippet(assetByPath(assets, "assets/csv/users.csv"), 14),
      groups: snippet(assetByPath(assets, "assets/csv/groups.csv"), 14),
      processSnapshot: snippet(
        assetByPath(assets, "assets/runtime/process_snapshot.txt"),
        20
      ),
      openFiles: snippet(assetByPath(assets, "assets/runtime/open_files.txt"), 18),
      packageSummary: snippet(
        firstMatchingAsset(assets, [
          /assets\/inventory\/package_inventory\.txt$/,
          /assets\/logs\/apt_history\.log$/,
        ]),
        20
      ),
      keyConfiguration: [
        snippet(firstMatchingAsset(assets, [/sshd_config$/, /sudoers/i]), 18),
        snippet(firstMatchingAsset(assets, [/cron/i, /systemd/i]), 18),
      ].filter(Boolean),
      representativeLogs: [
        snippet(assetByPath(assets, "assets/logs/auth.log"), 18),
        snippet(assetByPath(assets, "assets/logs/sudo.log"), 14),
        snippet(assetByPath(assets, "assets/logs/audit.log"), 18),
        snippet(assetByPath(assets, "assets/logs/syslog"), 18),
        snippet(assetByPath(assets, "assets/journal/journal_systemd.txt"), 16),
      ].filter(Boolean),
    },
  };
}

function parseReviewJson(text: string): AIQualityReviewResult {
  const parsed = JSON.parse(text) as Partial<AIQualityReviewResult>;
  const rawScore = Number(parsed.score) || 0;
  const normalizedScore = rawScore > 0 && rawScore <= 10 ? rawScore * 10 : rawScore;
  const score = Math.max(0, Math.min(100, normalizedScore));
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((issue): issue is AIQualityIssue => {
          if (typeof issue !== "object" || issue === null) return false;
          const candidate = issue as Partial<AIQualityIssue>;
          return (
            ["low", "medium", "high"].includes(String(candidate.severity)) &&
            typeof candidate.category === "string" &&
            typeof candidate.description === "string"
          );
        })
        .slice(0, 8)
    : [];

  const hasMaterialIssue = issues.some((issue) =>
    ["medium", "high"].includes(issue.severity)
  );
  const decision: "PASS" | "FAIL" =
    score >= 95 || (score >= 90 && !hasMaterialIssue) ? "PASS" : "FAIL";

  return {
    score,
    decision,
    issues,
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary.slice(0, 800)
        : "AI quality review completed.",
  };
}

export async function reviewInvestigationQuality(
  input: QualityReviewInput
): Promise<AIQualityReviewResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const payload = compactReviewPayload(input);
  const systemPrompt = `
You are a Senior DFIR/SOC quality reviewer for CyberLab.
For Linux investigations, apply experienced Senior Linux DFIR judgment.

You do not regenerate assets. You do not rewrite the lab. You do not solve the lab.
You only judge whether the generated investigation feels realistic enough for a paid SOC/DFIR exercise.

Reject only quality problems: subtle contradictions, unrealistic Linux behaviour, daemon or package-management behaviour that does not fit, documentation that feels fake, process relationships that are impossible, host-role mismatch, repeated wording, AI-sounding prose, or obvious generator fingerprints.

Do not reject because evidence is incomplete, uncertain, ambiguous, or requires analyst investigation.
Uncertainty and multiple hypotheses are desirable.

Return strict JSON only.
`.trim();

  const response = await fetchOpenAI("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      instructions: systemPrompt,
      input: JSON.stringify(payload),
      max_output_tokens: 1200,
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: "cyberlab_investigation_quality_review",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: { type: "number", minimum: 0, maximum: 100 },
              decision: { type: "string", enum: ["PASS", "FAIL"] },
              issues: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    severity: {
                      type: "string",
                      enum: ["low", "medium", "high"],
                    },
                    category: { type: "string", maxLength: 60 },
                    description: { type: "string", maxLength: 260 },
                  },
                  required: ["severity", "category", "description"],
                },
              },
              summary: { type: "string", maxLength: 800 },
            },
            required: ["score", "decision", "issues", "summary"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`AI quality review failed: ${details}`);
  }

  const data = (await response.json()) as { output_text?: string; output?: unknown[] };
  const text =
    data.output_text ||
    (Array.isArray(data.output)
      ? data.output
          .flatMap((item) =>
            typeof item === "object" && item !== null && "content" in item
              ? (item as { content?: Array<{ text?: string }> }).content || []
              : []
          )
          .map((content) => content.text || "")
          .join("")
          .trim()
      : "");

  return parseReviewJson(text);
}
