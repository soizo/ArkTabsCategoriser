import { describe, expect, it } from "vitest";
import {
  ArkError,
  appendDiagnosticOutput,
  errorPayload,
  formatDiagnostic,
  sanitiseProviderMessage,
} from "../src/errors";

const diagnostic = {
  stage: "response",
  reason: "missing_content",
  status: 429,
  origin: "https://api.example",
  providerMessage: "No output was returned.",
  context: "choices[0].message.content was empty",
} as const;

describe("safe error diagnostics", () => {
  it("serialises a known Ark error without its Error message", () => {
    const error = new ArkError("invalid_response", diagnostic);

    expect(errorPayload(error)).toEqual({
      errorCode: "invalid_response",
      diagnostic,
    });
    expect(error.message).toBe("invalid_response");
  });

  it("turns unknown exceptions into an application-authored fallback", () => {
    expect(
      errorPayload(new Error("private stack detail"), "grouping_failed", {
        stage: "grouping",
        reason: "chrome_rejected",
      }),
    ).toEqual({
      errorCode: "grouping_failed",
      diagnostic: { stage: "grouping", reason: "chrome_rejected" },
    });
  });

  it("removes credentials, URLs, controls, and excessive provider text", () => {
    const message = `Bearer gsk_secret\nSee https://private.example/path ${"x".repeat(400)}`;
    const safe = sanitiseProviderMessage(message, ["gsk_secret"]);

    expect(safe).not.toContain("gsk_secret");
    expect(safe).not.toContain("private.example");
    expect(safe).not.toContain("\n");
    expect(safe?.length).toBeLessThanOrEqual(241);
  });

  it("appends diagnostics without discarding existing reasoning", () => {
    const labels = (field: string): string => field.toUpperCase();
    const formatted = formatDiagnostic(diagnostic, labels);

    expect(appendDiagnosticOutput("Thinking.", diagnostic, labels)).toBe(
      `Thinking.\n\n---\n${formatted}`,
    );
    expect(appendDiagnosticOutput("", diagnostic, labels)).toBe(formatted);
  });

  it("formats only populated diagnostic fields", () => {
    expect(formatDiagnostic(diagnostic, (field) => field.toUpperCase())).toBe(
      [
        "STAGE: response",
        "REASON: missing_content",
        "STATUS: 429",
        "ORIGIN: https://api.example",
        "PROVIDER_MESSAGE: No output was returned.",
        "CONTEXT: choices[0].message.content was empty",
      ].join("\n"),
    );
  });
});
