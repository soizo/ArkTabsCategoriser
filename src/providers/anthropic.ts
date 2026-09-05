import {
  buildCategorisationPrompt,
  parseCategorisation,
} from "../categorisation";
import type { TabInput } from "../domain";
import { ArkError } from "../errors";
import type { ProviderSettings } from "../settings";
import {
  isRecord,
  requestJson,
  uniqueModels,
  type Fetch,
  type Provider,
} from "./types";

const BASE_URL = "https://api.anthropic.com/v1";

function headers(settings: ProviderSettings): Record<string, string> {
  return {
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

function modelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_models",
      context: "Expected data to contain a model list",
    });
  }
  return uniqueModels(
    value.data.flatMap((item) => {
      return isRecord(item) && typeof item.id === "string" ? [item.id] : [];
    }),
  );
}

function messageText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_content",
      context: "Anthropic response text was empty",
    });
  }
  const text = value.content
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.type === "text",
    )
    .map((item) => item.text)
    .filter((item): item is string => typeof item === "string")
    .join("");
  if (!text)
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "missing_content",
      context: "Anthropic response text was empty",
    });
  return text;
}

export function createAnthropicProvider(fetchImpl: Fetch): Provider {
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
      const value = await requestJson(
        fetchImpl,
        `${BASE_URL}/messages`,
        {
          method: "POST",
          headers: headers(settings),
          body: JSON.stringify({
            model: settings.model,
            max_tokens: 8,
            temperature: 0,
            messages: [{ role: "user", content: "Reply with OK." }],
          }),
        },
        signal,
      );
      messageText(value);
    },

    async categorise(
      settings: ProviderSettings,
      tabs: TabInput[],
      locale,
      signal,
      systemPrompt,
    ) {
      const prompt = buildCategorisationPrompt(tabs, locale, systemPrompt);
      const value = await requestJson(
        fetchImpl,
        `${BASE_URL}/messages`,
        {
          method: "POST",
          headers: headers(settings),
          body: JSON.stringify({
            model: settings.model,
            max_tokens: 2048,
            temperature: 0,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.user }],
          }),
        },
        signal,
      );
      return parseCategorisation(
        messageText(value),
        tabs.map(({ id }) => id),
      );
    },
  };
}
