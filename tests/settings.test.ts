import { describe, expect, it } from "vitest";
import {
  activateProvider,
  loadSettings,
  saveProvider,
  type StorageArea,
} from "../src/settings";

function createStorage(initial: Record<string, unknown> = {}): StorageArea & {
  snapshot(): Record<string, unknown>;
} {
  let data = structuredClone(initial);
  return {
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(value) {
      data = { ...data, ...structuredClone(value) };
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}

describe("provider settings", () => {
  it("returns an empty provider map when storage has no settings", async () => {
    await expect(loadSettings(createStorage())).resolves.toEqual({
      providers: {},
    });
  });

  it("ignores malformed stored settings", async () => {
    await expect(
      loadSettings(createStorage({ arkSettings: "broken" })),
    ).resolves.toEqual({
      providers: {},
    });
  });

  it("keeps each provider configuration and activates the last saved one", async () => {
    const storage = createStorage();

    await saveProvider(storage, "openai", {
      apiKey: "openai-key",
      model: "gpt-4.1",
    });
    await saveProvider(storage, "anthropic", {
      apiKey: "anthropic-key",
      model: "claude-sonnet-4",
    });

    await expect(loadSettings(storage)).resolves.toEqual({
      activeProvider: "anthropic",
      providers: {
        openai: { apiKey: "openai-key", model: "gpt-4.1" },
        anthropic: { apiKey: "anthropic-key", model: "claude-sonnet-4" },
      },
    });
  });

  it("stores one global edited system prompt with provider settings", async () => {
    const storage = createStorage();

    await saveProvider(
      storage,
      "openai",
      { apiKey: "key", model: "gpt-4.1" },
      "  My complete prompt  ",
    );

    await expect(loadSettings(storage)).resolves.toMatchObject({
      systemPrompt: "My complete prompt",
    });
  });

  it("activates an already configured provider without changing its settings", async () => {
    const storage = createStorage();
    await saveProvider(
      storage,
      "openai",
      { apiKey: "openai-key", model: "gpt-4.1" },
      "Prompt",
    );
    await saveProvider(storage, "anthropic", {
      apiKey: "anthropic-key",
      model: "claude-sonnet-4",
    });

    await expect(activateProvider(storage, "openai")).resolves.toMatchObject({
      activeProvider: "openai",
      systemPrompt: "Prompt",
      providers: {
        openai: { apiKey: "openai-key", model: "gpt-4.1" },
        anthropic: { apiKey: "anthropic-key", model: "claude-sonnet-4" },
      },
    });
  });

  it("trims saved fields without changing the custom base path", async () => {
    const storage = createStorage();

    await saveProvider(storage, "custom", {
      apiKey: "  key  ",
      model: "  local-model  ",
      baseUrl: "  https://llm.example/v1/  ",
    });

    expect(storage.snapshot()).toEqual({
      arkSettings: {
        activeProvider: "custom",
        providers: {
          custom: {
            apiKey: "key",
            model: "local-model",
            baseUrl: "https://llm.example/v1/",
          },
        },
      },
    });
  });

  it.each([
    ["missing API key", "openai", { apiKey: " ", model: "gpt-4.1" }],
    ["missing model", "openai", { apiKey: "key", model: " " }],
    ["missing custom base URL", "custom", { apiKey: "key", model: "model" }],
  ] as const)("rejects %s", async (_name, provider, settings) => {
    const storage = createStorage();
    await expect(saveProvider(storage, provider, settings)).rejects.toThrow();
    expect(storage.snapshot()).toEqual({});
  });
});
