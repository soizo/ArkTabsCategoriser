import type { Categorisation, TabInput } from "../domain";
import { ArkError } from "../errors";
import type { ProviderSettings } from "../settings";

export type Fetch = typeof fetch;

export type Provider = {
  listModels(
    settings: ProviderSettings,
    signal: AbortSignal,
  ): Promise<string[]>;
  testConnection(
    settings: ProviderSettings,
    signal: AbortSignal,
  ): Promise<void>;
  categorise(
    settings: ProviderSettings,
    tabs: TabInput[],
    locale: string,
    signal: AbortSignal,
    systemPrompt?: string,
    onReasoning?: (text: string) => void,
  ): Promise<Categorisation>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function uniqueModels(models: string[]): string[] {
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

export function arkErrorForStatus(status: number): ArkError {
  if (status === 401) return new ArkError("unauthorised");
  if (status === 403) return new ArkError("forbidden");
  if (status === 408) return new ArkError("timeout");
  if (status === 429) return new ArkError("rate_limited");
  return new ArkError("network");
}

export async function requestResponse(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ArkError("timeout");
    }
    throw new ArkError("network");
  }

  if (!response.ok) throw arkErrorForStatus(response.status);
  return response;
}

export async function requestJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await requestResponse(fetchImpl, url, init, signal);
  try {
    return await response.json();
  } catch {
    throw new ArkError("invalid_response");
  }
}
