import { AI_CONFIG, AIModel } from "./config";
import { fetchOpenAI } from "./openaiFetch";

type GenerateAIResponseArgs = {
  model: AIModel;
  systemPrompt: string;
  input: string;
  maxOutputTokens?: number;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

function extractText(data: OpenAIResponse) {
  let text = data.output_text;

  if (!text && Array.isArray(data.output)) {
    text = data.output
      .flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
      .trim();
  }

  return text || "";
}

export async function generateAIResponse({
  model,
  systemPrompt,
  input,
  maxOutputTokens,
}: GenerateAIResponseArgs) {
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
      instructions: systemPrompt,
      input,
      max_output_tokens: maxOutputTokens ?? AI_CONFIG.MAX_OUTPUT_TOKENS,
reasoning: {
  effort: "minimal",
},
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${errorText}`);
  }

  const data = (await response.json()) as OpenAIResponse;

  return {
  text: extractText(data),
  raw: data,
};
}

export async function generateConversationTitle(message: string) {
  if (!process.env.OPENAI_API_KEY) {
    return message.slice(0, 60);
  }

  const response = await fetchOpenAI("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_CONFIG.DEFAULT_MODEL,
      instructions:
        "Create a short CyberLab AI chat title. Use 3 to 6 words. No quotes. No punctuation unless needed.",
      input: `User message: ${message}`,
      max_output_tokens: 20,
    }),
  });

  if (!response.ok) {
    return message.slice(0, 60);
  }

  const data = (await response.json()) as OpenAIResponse;
  const title = extractText(data).trim();

  return title ? title.slice(0, 60) : message.slice(0, 60);
}
