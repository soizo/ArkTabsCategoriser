import { describe, expect, it } from "vitest";
import {
  hasProviderPermission,
  providerOrigin,
  requestProviderPermission,
  type PermissionsPort,
} from "../src/permissions";
import type { ProviderSettings } from "../src/settings";

const settings: ProviderSettings = { apiKey: "key", model: "model" };

function permissionsPort(
  result: boolean,
): PermissionsPort & { requested: string[][]; checked: string[][] } {
  const requested: string[][] = [];
  const checked: string[][] = [];
  return {
    requested,
    checked,
    async request({ origins }) {
      requested.push(origins);
      return result;
    },
    async contains({ origins }) {
      checked.push(origins);
      return result;
    },
  };
}

describe("providerOrigin", () => {
  it.each([
    ["openai", "https://api.openai.com"],
    ["anthropic", "https://api.anthropic.com"],
    ["gemini", "https://generativelanguage.googleapis.com"],
    ["openrouter", "https://openrouter.ai"],
  ] as const)("returns the fixed %s origin", (provider, origin) => {
    expect(providerOrigin(provider, settings)).toBe(origin);
  });

  it("keeps only the origin of a custom HTTPS base URL", () => {
    expect(
      providerOrigin("custom", {
        ...settings,
        baseUrl: "https://llm.example/v1/",
      }),
    ).toBe("https://llm.example");
  });

  it.each([
    ["http://localhost:11434/v1", "http://localhost:11434"],
    ["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080"],
  ])("allows the loopback endpoint %s", (baseUrl, origin) => {
    expect(providerOrigin("custom", { ...settings, baseUrl })).toBe(origin);
  });

  it.each(["http://llm.example/v1", "ftp://llm.example/v1", "not a URL"])(
    "rejects the unsafe custom endpoint %s",
    (baseUrl) => {
      expect(() =>
        providerOrigin("custom", { ...settings, baseUrl }),
      ).toThrow();
    },
  );
});

describe("provider permissions", () => {
  it("requests only the selected provider origin", async () => {
    const port = permissionsPort(true);

    await requestProviderPermission(port, "openai", settings);

    expect(port.requested).toEqual([["https://api.openai.com/*"]]);
  });

  it("reports a denied permission with a stable error code", async () => {
    await expect(
      requestProviderPermission(permissionsPort(false), "openai", settings),
    ).rejects.toMatchObject({
      code: "permission_denied",
      diagnostic: {
        stage: "permission",
        reason: "permission_denied",
        origin: "https://api.openai.com",
      },
    });
  });

  it("checks an existing permission without requesting it", async () => {
    const port = permissionsPort(true);

    await expect(
      hasProviderPermission(port, "openrouter", settings),
    ).resolves.toBe(true);
    expect(port.checked).toEqual([["https://openrouter.ai/*"]]);
    expect(port.requested).toEqual([]);
  });
});
