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

export class ArkError extends Error {
  constructor(
    public readonly code: ArkErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "ArkError";
  }
}
