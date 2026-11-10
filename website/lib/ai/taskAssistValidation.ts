const ALLOWED_MODES = ["explain", "hint", "command", "quiz"] as const;
const ALLOWED_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;

export type TaskAssistMode = (typeof ALLOWED_MODES)[number];

export type TaskAssistInput = {
  mode: TaskAssistMode;
  task: string;
  objective: string;
  scenario: string;
  difficulty: (typeof ALLOWED_DIFFICULTIES)[number];
};

type ValidationResult =
  | { success: true; data: TaskAssistInput }
  | { success: false; error: string };

const FIELD_LIMITS = {
  task: { min: 3, max: 2_000 },
  objective: { min: 3, max: 1_000 },
  scenario: { min: 3, max: 4_000 },
} as const;

function validateText(
  body: Record<string, unknown>,
  field: keyof typeof FIELD_LIMITS
): { value: string } | { error: string } {
  if (typeof body[field] !== "string") {
    return { error: `${field[0].toUpperCase()}${field.slice(1)} is required.` };
  }

  const value = body[field].trim();
  const limits = FIELD_LIMITS[field];

  if (value.length < limits.min) {
    return {
      error: `${field[0].toUpperCase()}${field.slice(1)} is too short.`,
    };
  }

  if (value.length > limits.max) {
    return {
      error: `${field[0].toUpperCase()}${field.slice(1)} is too long.`,
    };
  }

  return { value };
}

export function validateTaskAssistInput(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, error: "Invalid request body." };
  }

  const body = input as Record<string, unknown>;
  const mode =
    typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";

  if (!ALLOWED_MODES.includes(mode as TaskAssistMode)) {
    return { success: false, error: "Invalid mode." };
  }

  if (
    typeof body.difficulty !== "string" ||
    !ALLOWED_DIFFICULTIES.includes(
      body.difficulty.trim() as TaskAssistInput["difficulty"]
    )
  ) {
    return { success: false, error: "Invalid difficulty." };
  }

  const task = validateText(body, "task");
  if ("error" in task) return { success: false, error: task.error };

  const objective = validateText(body, "objective");
  if ("error" in objective) {
    return { success: false, error: objective.error };
  }

  const scenario = validateText(body, "scenario");
  if ("error" in scenario) return { success: false, error: scenario.error };

  return {
    success: true,
    data: {
      mode: mode as TaskAssistMode,
      task: task.value,
      objective: objective.value,
      scenario: scenario.value,
      difficulty: body.difficulty.trim() as TaskAssistInput["difficulty"],
    },
  };
}
