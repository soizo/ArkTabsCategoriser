import type { Categorisation, TabInput } from '../domain';
import { ArkError } from '../errors';
import type { ProviderSettings } from '../settings';

export type Fetch = typeof fetch;

export type Provider = {
  listModels(settings: ProviderSettings, signal: AbortSignal): Promise<string[]>;
  categorise(
    settings: ProviderSettings,
    tabs: TabInput[],
    locale: string,
    signal: AbortSignal,
  ): Promise<Categorisation>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function uniqueModels(models: string[]): string[] {
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

export async function requestJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ArkError('timeout');
    }
    throw new ArkError('network');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ArkError('unauthorised');
    }
    if (response.status === 429) throw new ArkError('rate_limited');
    throw new ArkError('network');
  }

  try {
    return await response.json();
  } catch {
    throw new ArkError('invalid_response');
  }
}
