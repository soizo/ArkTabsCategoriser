import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function messages(locale: "en" | "zh_CN"): Record<string, { message: string }> {
  return JSON.parse(
    readFileSync(`public/_locales/${locale}/messages.json`, "utf8"),
  );
}

describe("locale messages", () => {
  it("keeps English and Chinese diagnostic console keys aligned", () => {
    const en = messages("en");
    const zh = messages("zh_CN");
    const keys = [
      "output",
      "diagnosticStage",
      "diagnosticReason",
      "diagnosticStatus",
      "diagnosticOrigin",
      "diagnosticProviderMessage",
      "diagnosticContext",
    ];

    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of keys) {
      expect(en[key]?.message).toBeTruthy();
      expect(zh[key]?.message).toBeTruthy();
    }
  });
});
