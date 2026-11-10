import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";
import { chooseAIModel } from "@/lib/ai/modelRouter";
import { generateAIResponse } from "@/lib/ai/openai";
import {
  recordAIUsage,
  releaseAIUsageReservation,
  reserveAIUsage,
} from "@/lib/ai/usageService";
import { fetchOpenAI, OpenAITimeoutError } from "@/lib/ai/openaiFetch";
import {
  type TaskAssistMode,
  validateTaskAssistInput,
} from "@/lib/ai/taskAssistValidation";
import { sanitizeLinuxLearnerText } from "@/lib/lab-assets/linux/simulation";

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function textFromContentItem(content: unknown) {
  return typeof content === "object" && content !== null && "text" in content
    ? String((content as { text?: unknown }).text || "")
    : "";
}

function extractText(data: unknown) {
  const response = data as {
    output_text?: unknown;
    output?: Array<{ content?: unknown[] }>;
  };
  return (
    String(response.output_text || "") ||
    response.output
      ?.flatMap((item) => Array.isArray(item.content) ? item.content : [])
      ?.map(textFromContentItem)
      ?.join("")
      ?.trim() ||
    ""
  );
}

function buildPrompt({
  mode,
  task,
  objective,
  scenario,
  difficulty,
}: {
  mode: TaskAssistMode;
  task: string;
  objective: string;
  scenario: string;
  difficulty: string;
}) {
  const base = `
You are CyberLab AI.

You help with safe, defensive, authorised cybersecurity learning only.

Lab objective:
${objective}

Lab scenario:
${scenario}

Difficulty:
${difficulty}

Current task:
${task}

Rules:
- Stay strictly within this task.
- Do not answer unrelated topics.
- Do not expose internal canonical IDs, graph node names, registry identifiers, or relationship keys such as identity:, session:, command:, process:, file:, executed_by, spawned_process, opened_file, covered_by_change, inside_maintenance_window, authenticated_as, service_state, or service_transition.
- Use analyst wording such as "the SSH session", "the observed command", "executed by", "accessed file", and "approved maintenance window".
- Keep the answer concise.
- No real-world attacks.
- No malware.
- No phishing.
- No credential theft.
- No evasion.
- No persistence.
- Only local, owned, simulated, or authorised lab environments.
`.trim();

  if (mode === "explain") {
    return `
${base}

Mode: Explain

Explain ONLY what this task means and why it matters.
Do not give commands.
Do not give hints.
Do not create a quiz.
Maximum 120 words.
`.trim();
  }

  if (mode === "hint") {
    return `
${base}

Mode: Hint

Give ONE helpful hint only.
Do not solve the task.
Do not give commands.
Do not create a quiz.
Maximum 60 words.
`.trim();
  }

  if (mode === "command") {
    return `
${base}

Mode: Command

Give only safe commands for a local/authorised lab.
Maximum 5 commands.
For each command, add one short explanation.
Do not give a quiz.
Do not add a long tutorial.
`.trim();
  }

  return `
${base}

Mode: Quiz

Create ONE multiple-choice quiz question about this task.

Requirements:
- One question only.
- Exactly four options.
- One correct answer.
- Three plausible distractors.
- Explanation must be ONE concise paragraph (maximum 2 sentences, under 80 words).
- Finish the explanation completely. Never end mid-sentence or mid-word.
- Return only the quiz JSON.
Each option should be one short sentence or phrase.
Maximum 15 words.
`.trim();
}

function shuffleOptions(options: string[], correctIndex: number) {
  const items = options.map((text, index) => ({
    text: String(text).replace(/^[A-D][).]\s*/i, "").trim(),
    isCorrect: index === correctIndex,
  }));

  const shuffled = [...items].sort(() => Math.random() - 0.5);
  const correctLetter = ["A", "B", "C", "D"][
    shuffled.findIndex((item) => item.isCorrect)
  ];

  return {
    options: shuffled.map((item) => item.text),
    correct: correctLetter,
  };
}

async function generateQuiz({
  model,
  prompt,
}: {
  model: string;
  prompt: string;
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetchOpenAI("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
  "You are CyberLab AI. Create concise, safe cybersecurity quiz questions only. Explanations must be complete sentences and must not end mid-word or mid-sentence.",
      input: prompt,
      max_output_tokens: 900,
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: "cyberlab_task_quiz",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              question: { type: "string", maxLength: 220 },
              correctAnswer: { type: "string", maxLength: 160 },
              distractors: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: { type: "string", maxLength: 160 },
              },
              explanation: { type: "string", maxLength: 320 },
            },
            required: [
              "question",
              "correctAnswer",
              "distractors",
              "explanation",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI quiz request failed: ${errorText}`);
  }

  const data = await response.json();
  const rawText = extractText(data);
  const quiz = JSON.parse(rawText);

  const allOptions = [
    String(quiz.correctAnswer),
    ...quiz.distractors.map((item: string) => String(item)),
  ];

  const shuffled = shuffleOptions(allOptions, 0);

  return `Question: ${quiz.question}

A) ${shuffled.options[0]}
B) ${shuffled.options[1]}
C) ${shuffled.options[2]}
D) ${shuffled.options[3]}

Correct answer: ${shuffled.correct}

Explanation: ${quiz.explanation}`;
}

export async function POST(req: Request) {
  let reservationId: string | undefined;

  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (profile?.plan !== "pro") {
      return NextResponse.json(
        { error: "AI task guidance is available on Amniora Pro." },
        { status: 403 }
      );
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 16_384) {
      return NextResponse.json(
        { error: "Request body is too large." },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const validation = validateTaskAssistInput(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { mode, task, objective, scenario, difficulty } = validation.data;

    const usage = await reserveAIUsage(user.id, "tutor_prompt");
    if (!usage.allowed || !usage.reservationId) {
      return NextResponse.json(
        { error: usage.reason, usage },
        { status: 403 }
      );
    }
    reservationId = usage.reservationId;

    const prompt = buildPrompt({
      mode,
      task,
      objective,
      scenario,
      difficulty,
    });

    const model = chooseAIModel({
      feature: "tutor_prompt",
      plan: "pro",
      complexity: "normal",
    });

    let responseText = "";

    if (mode === "quiz") {
      responseText = await generateQuiz({
        model,
        prompt,
      });
    } else {
      const ai = await generateAIResponse({
        model,
        systemPrompt:
          "You are CyberLab AI. You provide concise, safe, defensive cybersecurity learning support. Follow the requested mode exactly.",
        input: prompt,
        maxOutputTokens: mode === "command" ? 600 : 350,
      });

      responseText = ai.text;
    }

    responseText = sanitizeLinuxLearnerText(responseText);

    await recordAIUsage({
      reservationId,
      userId: user.id,
      feature: "tutor_prompt",
      modelUsed: model,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(responseText),
      estimatedCost: 0,
    });
    reservationId = undefined;

    return NextResponse.json({
      response: responseText,
      mode,
    });
  } catch (error) {
    await releaseAIUsageReservation(reservationId);

    if (error instanceof OpenAITimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }

    return NextResponse.json(
      {
        error: "AI task guidance is temporarily unavailable. Please try again.",
      },
      { status: 500 }
    );
  }
}
