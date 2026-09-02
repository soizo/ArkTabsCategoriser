import type { ProviderId } from '../domain';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { Fetch, Provider } from './types';

export function getProvider(id: ProviderId, fetchImpl: Fetch = fetch): Provider {
  if (id === 'anthropic') return createAnthropicProvider(fetchImpl);
  if (id === 'gemini') return createGeminiProvider(fetchImpl);
  return createOpenAICompatibleProvider(id, fetchImpl);
}
