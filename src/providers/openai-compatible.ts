import { buildCategorisationPrompt, parseCategorisation } from '../categorisation';
import type { Categorisation, ProviderId, TabInput } from '../domain';
import { ArkError } from '../errors';
import type { ProviderSettings } from '../settings';
import {
  isRecord,
  requestJson,
  uniqueModels,
  type Fetch,
  type Provider,
} from './types';

type CompatibleProviderId = Extract<ProviderId, 'openai' | 'openrouter' | 'custom'>;

type CompatibleConfig = {
  baseUrl: string;
  modelsPath: string;
  chatPath: string;
  structuredOutput: boolean;
  extraHeaders?: Record<string, string>;
};

function configFor(id: CompatibleProviderId, settings: ProviderSettings): CompatibleConfig {
  if (id === 'openai') {
    return {
      baseUrl: 'https://api.openai.com',
      modelsPath: '/v1/models',
      chatPath: '/v1/chat/completions',
      structuredOutput: true,
    };
  }
  if (id === 'openrouter') {
    return {
      baseUrl: 'https://openrouter.ai',
      modelsPath: '/api/v1/models',
      chatPath: '/api/v1/chat/completions',
      structuredOutput: false,
      extraHeaders: { 'X-Title': 'Ark (Tabs Categoriser)' },
    };
  }
  if (!settings.baseUrl) throw new TypeError('Custom base URL is required');
  return {
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    modelsPath: '/models',
    chatPath: '/chat/completions',
    structuredOutput: false,
  };
}

function endpoint(config: CompatibleConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}${path}`;
}

function headers(settings: ProviderSettings, config: CompatibleConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
    ...config.extraHeaders,
  };
}

function modelIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new ArkError('invalid_response');
  }
  return uniqueModels(value.data.flatMap((item) => {
    return isRecord(item) && typeof item.id === 'string' ? [item.id] : [];
  }));
}

function completionText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new ArkError('invalid_response');
  }
  const choice = value.choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(message) || typeof message.content !== 'string') {
    throw new ArkError('invalid_response');
  }
  return message.content;
}

export function createOpenAICompatibleProvider(
  id: CompatibleProviderId,
  fetchImpl: Fetch,
): Provider {
  return {
    async listModels(settings, signal) {
      const config = configFor(id, settings);
      const value = await requestJson(fetchImpl, endpoint(config, config.modelsPath), {
        method: 'GET',
        headers: headers(settings, config),
      }, signal);
      return modelIds(value);
    },

    async categorise(settings, tabs, locale, signal): Promise<Categorisation> {
      const config = configFor(id, settings);
      const prompt = buildCategorisationPrompt(tabs, locale);
      const body: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0,
      };
      if (config.structuredOutput) body.response_format = { type: 'json_object' };

      const value = await requestJson(fetchImpl, endpoint(config, config.chatPath), {
        method: 'POST',
        headers: headers(settings, config),
        body: JSON.stringify(body),
      }, signal);
      return parseCategorisation(completionText(value), tabs.map(({ id: tabId }) => tabId));
    },
  };
}
