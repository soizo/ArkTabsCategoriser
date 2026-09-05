import type { Categorisation, TabInput } from "../domain";
import {
  ArkError,
  sanitiseProviderMessage,
  type ArkDiagnostic,
} from "../errors";
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

export function arkErrorForStatus(
  status: number,
  diagnostic?: ArkDiagnostic,
): ArkError {
  if (status === 401) return new ArkError("unauthorised", diagnostic);
  if (status === 403) return new ArkError("forbidden", diagnostic);
  if (status === 408) return new ArkError("timeout", diagnostic);
  if (status === 429) return new ArkError("rate_limited", diagnostic);
  return new ArkError("network", diagnostic);
}

function origin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function authenticationSecrets(headers: HeadersInit | undefined): string[] {
  const values = new Headers(headers);
  return [
    values.get("authorization")?.replace(/^Bearer\s+/i, ""),
    values.get("x-api-key"),
    values.get("x-goog-api-key"),
  ].filter((value): value is string => Boolean(value));
}

async function providerErrorMessage(
  response: Response,
  secrets: string[],
): Promise<string | undefined> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) return undefined;
    const error = isRecord(value.error) ? value.error : value;
    return sanitiseProviderMessage(error.message, secrets);
  } catch {
    return undefined;
  }
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
    const requestOrigin = origin(url);
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ArkError("timeout", {
        stage: "request",
        reason: "timeout",
        ...(requestOrigin ? { origin: requestOrigin } : {}),
      });
    }
    throw new ArkError("network", {
      stage: "request",
      reason: "request_failed",
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    });
  }

  if (!response.ok) {
    const requestOrigin = origin(url);
    const providerMessage = await providerErrorMessage(
      response,
      authenticationSecrets(init.headers),
    );
    throw arkErrorForStatus(response.status, {
      stage: "response",
      reason: "http_error",
      status: response.status,
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    });
  }
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
    const responseOrigin = origin(url);
    throw new ArkError("invalid_response", {
      stage: "response",
      reason: "invalid_json",
      ...(responseOrigin ? { origin: responseOrigin } : {}),
    });
  }
}
