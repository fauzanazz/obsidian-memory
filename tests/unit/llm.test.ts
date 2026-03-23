import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { callLLM, callLLMJson } from "../../src/lib/llm";

describe("callLLM", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("throws when API key env var is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(callLLM("test prompt")).rejects.toThrow(
      "LLM API key not found. Set the GEMINI_API_KEY environment variable."
    );
  });

  test("throws when custom API key env var is missing", async () => {
    delete process.env.MY_CUSTOM_KEY;

    await expect(
      callLLM("test prompt", {
        provider: "gemini",
        model: "gemini-2.0-flash",
        apiKeyEnv: "MY_CUSTOM_KEY",
      })
    ).rejects.toThrow(
      "LLM API key not found. Set the MY_CUSTOM_KEY environment variable."
    );
  });

  test("throws on unsupported provider", async () => {
    process.env.SOME_KEY = "test-key";

    await expect(
      callLLM("test prompt", {
        provider: "openai" as any,
        model: "gpt-4",
        apiKeyEnv: "SOME_KEY",
      })
    ).rejects.toThrow("Unsupported LLM provider: openai");
  });
});

describe("callLLMJson", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  test("throws on invalid JSON response", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "not valid json{" }],
              },
            },
          ],
        }),
        { status: 200 }
      );

    await expect(callLLMJson("test prompt")).rejects.toThrow();
  });

  test("parses valid JSON response", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const expected = { features: [], decisions: [] };
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(expected) }],
              },
            },
          ],
        }),
        { status: 200 }
      );

    const result = await callLLMJson("test prompt");
    expect(result).toEqual(expected);
  });

  test("throws on Gemini API error", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });

    await expect(callLLMJson("test prompt")).rejects.toThrow(
      "Gemini API error (401)"
    );
  });

  test("throws on empty Gemini response", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 });

    await expect(callLLMJson("test prompt")).rejects.toThrow(
      "Gemini returned empty response"
    );
  });
});
