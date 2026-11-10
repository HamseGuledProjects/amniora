// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import { fetchOpenAI, getOpenAITimeoutMs, OpenAITimeoutError } from "../../lib/ai/openaiFetch.ts";

test("uses a bounded configurable timeout", () => {
  const original = process.env.OPENAI_REQUEST_TIMEOUT_MS;

  process.env.OPENAI_REQUEST_TIMEOUT_MS = "250";
  assert.equal(getOpenAITimeoutMs(), 1_000);

  process.env.OPENAI_REQUEST_TIMEOUT_MS = "999999";
  assert.equal(getOpenAITimeoutMs(), 120_000);

  if (original === undefined) {
    delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
  } else {
    process.env.OPENAI_REQUEST_TIMEOUT_MS = original;
  }
});

test("aborts a hanging OpenAI request with a clean timeout error", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.OPENAI_REQUEST_TIMEOUT_MS;
  process.env.OPENAI_REQUEST_TIMEOUT_MS = "1000";

  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

  try {
    await assert.rejects(
      fetchOpenAI("https://api.openai.com/v1/responses"),
      OpenAITimeoutError
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) {
      delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
    } else {
      process.env.OPENAI_REQUEST_TIMEOUT_MS = originalTimeout;
    }
  }
});
