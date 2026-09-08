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
    timeoutMs?: number,
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
  const message = diagnostic?.providerMessage ?? "";
  if (
    status === 413 ||
    (status === 400 &&
      /(?:context|prompt|input|token).*(?:exceed|too (?:long|large)|maximum|max)/i.test(
        message,
      ))
  ) {
    return new ArkError("input_too_long", diagnostic);
  }
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

async function providerError(
  response: Response,
  secrets: string[],
): Promise<{ message?: string; inputTooLong: boolean }> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) return { inputTooLong: false };
    const error = isRecord(value.error) ? value.error : value;
    const code = typeof error.code === "string" ? error.code : "";
    const message = sanitiseProviderMessage(error.message, secrets);
    return {
      ...(message ? { message } : {}),
      inputTooLong:
        /(?:context_length_exceeded|prompt_too_long|input_too_long|request_too_large)/i.test(
          code,
        ),
    };
  } catch {
    return { inputTooLong: false };
  }
}

export async function requestResponse(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  onActivity?: () => void,
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

  if (onActivity) {
    onActivity();
    if (response.body) {
      const url = response.url;
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            if (chunk.byteLength) onActivity();
            controller.enqueue(chunk);
          },
        }),
        { signal },
      );
      response = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(response, "url", { value: url });
    }
  }

  if (!response.ok) {
    const requestOrigin = origin(url);
    const details = await providerError(
      response,
      authenticationSecrets(init.headers),
    );
    const diagnostic: ArkDiagnostic = {
      stage: "response",
      reason: "http_error",
      status: response.status,
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      ...(details.message ? { providerMessage: details.message } : {}),
    };
    if (details.inputTooLong) throw new ArkError("input_too_long", diagnostic);
    throw arkErrorForStatus(response.status, diagnostic);
  }
  return response;
}

export async function requestJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  onActivity?: () => void,
): Promise<unknown> {
  const response = await requestResponse(fetchImpl, url, init, signal, onActivity);
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
