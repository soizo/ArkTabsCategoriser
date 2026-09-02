import {
  buildCategorisationPrompt,
  parseCategorisation,
} from "../categorisation";
import type { Categorisation, ProviderId } from "../domain";
import { ArkError } from "../errors";
import { readSseData } from "../sse";
import type { ProviderSettings } from "../settings";
import {
  arkErrorForStatus,
  isRecord,
  requestJson,
  requestResponse,
  uniqueModels,
  type Fetch,
  type Provider,
} from "./types";

type CompatibleProviderId = Extract<
  ProviderId,
  "openai" | "openrouter" | "custom"
>;

type CompatibleConfig = {
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  structuredOutput: boolean;
  extraHeaders?: Record<string, string>;
};

function configFor(
  id: CompatibleProviderId,
  settings: ProviderSettings,
): CompatibleConfig {
  if (id === "openai") {
    return {
      baseUrl: "https://api.openai.com",
      modelsPath: "/v1/models",
      chatPath: "/v1/chat/completions",
      structuredOutput: true,
    };
  }
  if (id === "openrouter") {
    return {
      baseUrl: "https://openrouter.ai",
      modelsPath: "/api/v1/models",
      chatPath: "/api/v1/chat/completions",
      structuredOutput: false,
      extraHeaders: { "X-Title": "Ark (Tabs Categoriser)" },
    };
  }
  if (!settings.baseUrl) throw new TypeError("Custom base URL is required");
  return {
    baseUrl: settings.baseUrl.replace(/\/+$/, ""),
    modelsPath: "/models",
    chatPath: "/chat/completions",
    structuredOutput: false,
  };
}

function endpoint(config: CompatibleConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, "")}${path}`;
}

function headers(
  settings: ProviderSettings,
  config: CompatibleConfig,
): Record<string, string> {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
    ...config.extraHeaders,
  };
}

function modelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new ArkError("invalid_response");
  }
  return uniqueModels(
    value.data.flatMap((item) => {
      return isRecord(item) && typeof item.id === "string" ? [item.id] : [];
    }),
  );
}

function completionText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new ArkError("invalid_response");
  }
  const choice = value.choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  if (
    !isRecord(message) ||
    typeof message.content !== "string" ||
    !message.content
  ) {
    throw new ArkError("invalid_response");
  }
  return message.content;
}

function reasoningFragments(delta: Record<string, unknown>): string[] {
  const legacy =
    typeof delta.reasoning === "string" && delta.reasoning
      ? [delta.reasoning]
      : [];
  if (!Array.isArray(delta.reasoning_details)) return legacy;
  return [
    ...legacy,
    ...delta.reasoning_details.flatMap((detail) => {
      if (!isRecord(detail)) return [];
      if (detail.type === "reasoning.text" && typeof detail.text === "string") {
        return detail.text ? [detail.text] : [];
      }
      if (
        detail.type === "reasoning.summary" &&
        typeof detail.summary === "string"
      ) {
        return detail.summary ? [detail.summary] : [];
      }
      return [];
    }),
  ];
}

async function streamedCompletion(
  response: Response,
  onReasoning: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new ArkError("invalid_response");
  let content = "";
  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") break;

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new ArkError("invalid_response");
    }
    if (!isRecord(value)) throw new ArkError("invalid_response");
    if (isRecord(value.error)) {
      const code = Number(value.error.code);
      throw arkErrorForStatus(Number.isFinite(code) ? code : 500);
    }

    const choice = Array.isArray(value.choices) ? value.choices[0] : undefined;
    const delta = isRecord(choice) ? choice.delta : undefined;
    if (!isRecord(delta)) continue;
    for (const text of reasoningFragments(delta)) onReasoning(text);
    if (typeof delta.content === "string") content += delta.content;
  }
  if (!content) throw new ArkError("invalid_response");
  return content;
}

export function createOpenAICompatibleProvider(
  id: CompatibleProviderId,
  fetchImpl: Fetch,
): Provider {
  return {
    async listModels(settings, signal) {
      const config = configFor(id, settings);
      const value = await requestJson(
        fetchImpl,
        endpoint(config, config.modelsPath),
        {
          method: "GET",
          headers: headers(settings, config),
        },
        signal,
      );
      return modelIds(value);
    },

    async testConnection(settings, signal) {
      const config = configFor(id, settings);
      const value = await requestJson(
        fetchImpl,
        endpoint(config, config.chatPath),
        {
          method: "POST",
          headers: headers(settings, config),
          body: JSON.stringify({
            model: settings.model,
            messages: [{ role: "user", content: "Reply with OK." }],
            max_tokens: 8,
            temperature: 0,
          }),
        },
        signal,
      );
      completionText(value);
    },

    async categorise(
      settings,
      tabs,
      locale,
      signal,
      systemPrompt,
      onReasoning,
    ): Promise<Categorisation> {
      const config = configFor(id, settings);
      const prompt = buildCategorisationPrompt(tabs, locale, systemPrompt);
      const body: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0,
      };
      if (config.structuredOutput)
        body.response_format = { type: "json_object" };
      const stream = id === "openrouter" && onReasoning;
      if (stream) body.stream = true;

      const init = {
        method: "POST",
        headers: headers(settings, config),
        body: JSON.stringify(body),
      };
      const text = stream
        ? await streamedCompletion(
            await requestResponse(
              fetchImpl,
              endpoint(config, config.chatPath),
              init,
              signal,
            ),
            onReasoning,
          )
        : completionText(
            await requestJson(
              fetchImpl,
              endpoint(config, config.chatPath),
              init,
              signal,
            ),
          );
      return parseCategorisation(
        text,
        tabs.map(({ id: tabId }) => tabId),
      );
    },
  };
}
