export type ArkErrorCode =
  | "not_configured"
  | "permission_denied"
  | "unauthorised"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_response"
  | "tabs_changed"
  | "grouping_failed";

export type ArkDiagnosticStage =
  | "configuration"
  | "permission"
  | "request"
  | "response"
  | "validation"
  | "transport"
  | "grouping";

export type ArkDiagnosticReason =
  | "invalid_configuration"
  | "permission_denied"
  | "request_failed"
  | "timeout"
  | "http_error"
  | "invalid_json"
  | "missing_models"
  | "missing_content"
  | "malformed_stream"
  | "invalid_categorisation"
  | "tabs_changed"
  | "runtime_disconnected"
  | "chrome_rejected";

export type ArkDiagnostic = {
  stage: ArkDiagnosticStage;
  reason: ArkDiagnosticReason;
  status?: number;
  origin?: string;
  providerMessage?: string;
  context?: string;
};

export type ArkErrorPayload = {
  errorCode: ArkErrorCode;
  diagnostic?: ArkDiagnostic;
};

export type DiagnosticField =
  | "stage"
  | "reason"
  | "status"
  | "origin"
  | "provider_message"
  | "context";

export class ArkError extends Error {
  constructor(
    public readonly code: ArkErrorCode,
    public readonly diagnostic?: ArkDiagnostic,
  ) {
    super(code);
    this.name = "ArkError";
  }
}

export function errorPayload(
  error: unknown,
  fallbackCode: ArkErrorCode = "network",
  fallbackDiagnostic?: ArkDiagnostic,
): ArkErrorPayload {
  if (error instanceof ArkError) {
    return {
      errorCode: error.code,
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    };
  }
  return {
    errorCode: fallbackCode,
    ...(fallbackDiagnostic ? { diagnostic: fallbackDiagnostic } : {}),
  };
}

export function sanitiseProviderMessage(
  value: unknown,
  secrets: string[] = [],
): string | undefined {
  if (typeof value !== "string") return undefined;

  let safe = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[URL]");
  for (const secret of secrets) {
    if (secret) safe = safe.replaceAll(secret, "[REDACTED]");
  }
  safe = safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gsk|sk|AIza)[-_A-Za-z0-9]{8,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!safe) return undefined;
  return safe.length > 240 ? `${safe.slice(0, 240)}…` : safe;
}

export function appendDiagnosticOutput(
  existing: string,
  diagnostic: ArkDiagnostic,
  label: (field: DiagnosticField) => string,
): string {
  const details = formatDiagnostic(diagnostic, label);
  return existing ? `${existing}\n\n---\n${details}` : details;
}

export function formatDiagnostic(
  diagnostic: ArkDiagnostic,
  label: (field: DiagnosticField) => string,
): string {
  const values: Array<[DiagnosticField, string | number | undefined]> = [
    ["stage", diagnostic.stage],
    ["reason", diagnostic.reason],
    ["status", diagnostic.status],
    ["origin", diagnostic.origin],
    ["provider_message", diagnostic.providerMessage],
    ["context", diagnostic.context],
  ];
  return values
    .flatMap(([field, value]) =>
      value === undefined ? [] : [`${label(field)}: ${value}`],
    )
    .join("\n");
}
