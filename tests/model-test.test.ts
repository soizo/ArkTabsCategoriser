import { describe, expect, it, vi } from "vitest";
import { testActiveModel, type ModelTestDeps } from "../src/model-test";
import type { PermissionsPort } from "../src/permissions";
import type { Provider } from "../src/providers/types";
import type { ArkSettings, StorageArea } from "../src/settings";

function storageWith(settings?: ArkSettings): StorageArea {
  return {
    async get(key) {
      return settings ? { [key]: settings } : {};
    },
    async set() {},
  };
}

function permissions(granted = true): PermissionsPort {
  return {
    async request() {
      throw new Error("Background must not request permissions");
    },
    async contains() {
      return granted;
    },
  };
}

function configuredSettings(): ArkSettings {
  return {
    activeProvider: "openrouter",
    providers: {
      openrouter: { apiKey: "key", model: "openrouter/free" },
    },
  };
}

function provider(testConnection: Provider["testConnection"]): Provider {
  return {
    async listModels() {
      return [];
    },
    testConnection,
    async categorise() {
      throw new Error("Connection testing must not categorise tabs");
    },
  };
}

function deps(overrides: Partial<ModelTestDeps> = {}): ModelTestDeps {
  return {
    storage: storageWith(configuredSettings()),
    permissions: permissions(),
    providerFor: () => provider(async () => {}),
    timeoutMs: 100,
    ...overrides,
  };
}

describe("testActiveModel", () => {
  it("tests the saved active provider without reading tabs", async () => {
    const testConnection = vi.fn(async () => {});

    await testActiveModel(
      deps({ providerFor: () => provider(testConnection) }),
    );

    expect(testConnection).toHaveBeenCalledWith(
      { apiKey: "key", model: "openrouter/free" },
      expect.any(AbortSignal),
    );
  });

  it("rejects an unconfigured model before provider selection", async () => {
    let providerCalls = 0;
    await expect(
      testActiveModel(
        deps({
          storage: storageWith({ providers: {} }),
          providerFor: () => {
            providerCalls += 1;
            return provider(async () => {});
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "not_configured",
      diagnostic: {
        stage: "configuration",
        reason: "invalid_configuration",
        context: "No active provider and model were configured",
      },
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects missing permission without requesting it", async () => {
    await expect(
      testActiveModel(deps({ permissions: permissions(false) })),
    ).rejects.toMatchObject({
      code: "permission_denied",
      diagnostic: {
        stage: "permission",
        reason: "permission_denied",
      },
    });
  });

  it("uses a 60 second timeout by default", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const subject = deps({
      providerFor: () =>
        provider(async (_settings, receivedSignal) => {
          signal = receivedSignal;
          await new Promise<void>((_resolve, reject) => {
            receivedSignal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        }),
    });
    delete subject.timeoutMs;

    try {
      const result = expect(testActiveModel(subject)).rejects.toMatchObject({
        code: "timeout",
        diagnostic: { stage: "request", reason: "timeout" },
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
