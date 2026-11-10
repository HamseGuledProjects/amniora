const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const MIN_OPENAI_TIMEOUT_MS = 1_000;
const MAX_OPENAI_TIMEOUT_MS = 120_000;

export class OpenAITimeoutError extends Error {
  constructor() {
    super("The AI request timed out. Please try again.");
    this.name = "OpenAITimeoutError";
  }
}

export function getOpenAITimeoutMs() {
  const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS);

  if (!Number.isFinite(configured)) {
    return DEFAULT_OPENAI_TIMEOUT_MS;
  }

  return Math.min(
    MAX_OPENAI_TIMEOUT_MS,
    Math.max(MIN_OPENAI_TIMEOUT_MS, Math.trunc(configured))
  );
}

export async function fetchOpenAI(
  input: string | URL | Request,
  init?: RequestInit
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getOpenAITimeoutMs());

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new OpenAITimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
