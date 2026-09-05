import {
  buildCategorisationPrompt,
  parseCategorisation,
} from "../categorisation";
import { ArkError } from "../errors";
import type { ProviderSettings } from "../settings";
import {
  isRecord,
  requestJson,
  uniqueModels,
  type Fetch,
  type Provider,
} from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function headers(settings: ProviderSettings): Record<string, string> {
  return {
    "x-goog-api-key": settings.apiKey,
    "Content-Type": "application/json",
  };
}

function modelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_models",
      context: "Expected models to contain a model list",
    });
  }
  return uniqueModels(
    value.models.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== "string") return [];
      if (
        Array.isArray(item.supportedGenerationMethods) &&
        !item.supportedGenerationMethods.includes("generateContent")
      )
        return [];
      return [item.name.replace(/^models\//, "")];
    }),
  );
}

function candidateText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_content",
      context: "Gemini response text was empty",
    });
  }
  const candidate = value.candidates[0];
  const content = isRecord(candidate) ? candidate.content : undefined;
  const parts = isRecord(content) ? content.parts : undefined;
  if (!Array.isArray(parts))
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_content",
      context: "Gemini response text was empty",
    });
  const text = parts
    .flatMap((part) =>
      isRecord(part) && typeof part.text === "string" ? [part.text] : [],
    )
    .join("");
  if (!text)
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_content",
      context: "Gemini response text was empty",
    });
  return text;
}

export function createGeminiProvider(fetchImpl: Fetch): Provider {
  return {
    async listModels(settings, signal) {
      const value = await requestJson(
        fetchImpl,
        `${BASE_URL}/models`,
        {
          method: "GET",
          headers: headers(settings),
        },
        signal,
      );
      return modelIds(value);
    },

    async testConnection(settings, signal) {
      const model = settings.model.replace(/^models\//, "");
      const value = await requestJson(
        fetchImpl,
        `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: headers(settings),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
            generationConfig: {
              maxOutputTokens: 8,
              temperature: 0,
            },
          }),
        },
        signal,
      );
      candidateText(value);
    },

    async categorise(settings, tabs, locale, signal, systemPrompt) {
      const prompt = buildCategorisationPrompt(tabs, locale, systemPrompt);
      const model = settings.model.replace(/^models\//, "");
      const value = await requestJson(
        fetchImpl,
        `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: headers(settings),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: "user", parts: [{ text: prompt.user }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0,
            },
          }),
        },
        signal,
      );
      return parseCategorisation(
        candidateText(value),
        tabs.map(({ id }) => id),
      );
    },
  };
}
