import type { LLMConfig } from "./config";

export interface LLMResponse {
  text: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: "gemini",
  model: "gemini-2.0-flash",
  apiKeyEnv: "GEMINI_API_KEY",
};

export async function callLLM(
  prompt: string,
  config?: LLMConfig
): Promise<LLMResponse> {
  const cfg = config ?? DEFAULT_CONFIG;
  const apiKey = process.env[cfg.apiKeyEnv];

  if (!apiKey) {
    throw new Error(
      `LLM API key not found. Set the ${cfg.apiKeyEnv} environment variable.`
    );
  }

  if (cfg.provider === "gemini") {
    return callGemini(prompt, cfg.model, apiKey);
  }

  throw new Error(`Unsupported LLM provider: ${cfg.provider}`);
}

async function callGemini(
  prompt: string,
  model: string,
  apiKey: string
): Promise<LLMResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");

  return { text };
}

export async function callLLMJson<T>(
  prompt: string,
  config?: LLMConfig
): Promise<T> {
  const response = await callLLM(prompt, config);
  return JSON.parse(response.text) as T;
}
