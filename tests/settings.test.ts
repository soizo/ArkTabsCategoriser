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

  it("stores an optional input token limit with the model", async () => {
    const storage = createStorage();

    await saveProvider(storage, "openai", {
      apiKey: "key",
      model: "gpt-4.1",
      inputTokenLimit: 16_384,
    } as Parameters<typeof saveProvider>[2]);

    await expect(loadSettings(storage)).resolves.toMatchObject({
      providers: {
        openai: { inputTokenLimit: 16_384 },
      },
    });
  });

  it("rejects invalid input token limits", async () => {
    const storage = createStorage();

    await expect(
      saveProvider(storage, "openai", {
        apiKey: "key",
        model: "gpt-4.1",
        inputTokenLimit: 1.5,
      } as Parameters<typeof saveProvider>[2]),
    ).rejects.toThrow();
    expect(storage.snapshot()).toEqual({});
  });

  it("stores global classification requirements and Knowledge with provider settings", async () => {
    const storage = createStorage();

    await saveProvider(
      storage,
      "openai",
      { apiKey: "key", model: "gpt-4.1" },
      {
        classificationRequirements: "My requirements",
        knowledge: "foo.internal is our project tracker.",
      },
    );

    await expect(loadSettings(storage)).resolves.toMatchObject({
      classificationRequirements: "My requirements",
      knowledge: "foo.internal is our project tracker.",
    });
  });

  it("activates an already configured provider without changing its settings", async () => {
    const storage = createStorage();
    await saveProvider(
      storage,
      "openai",
      { apiKey: "openai-key", model: "gpt-4.1" },
      { classificationRequirements: "Prompt", knowledge: "Project context" },
    );
    await saveProvider(storage, "anthropic", {
      apiKey: "anthropic-key",
      model: "claude-sonnet-4",
    });

    await expect(activateProvider(storage, "openai")).resolves.toMatchObject({
      activeProvider: "openai",
      classificationRequirements: "Prompt",
      knowledge: "Project context",
      providers: {
        openai: { apiKey: "openai-key", model: "gpt-4.1" },
        anthropic: { apiKey: "anthropic-key", model: "claude-sonnet-4" },
      },
    });
  });

  it("migrates a legacy prompt verbatim without writing during load", async () => {
    const legacy = "  Old custom prompt\nKeep these rules.  ";
    const storage = createStorage({
      arkSettings: { providers: {}, systemPrompt: legacy },
    });
    await expect(loadSettings(storage)).resolves.toEqual({
      providers: {},
      classificationRequirements: legacy,
    });
    expect(storage.snapshot()).toEqual({
      arkSettings: { providers: {}, systemPrompt: legacy },
    });
    await saveProvider(storage, "openai", { apiKey: "key", model: "model" });
    expect(storage.snapshot().arkSettings).toMatchObject({
      classificationRequirements: legacy,
    });
    expect(storage.snapshot().arkSettings).not.toHaveProperty("systemPrompt");
  });

  it("prefers new requirements over the legacy prompt and ignores malformed Knowledge", async () => {
    const storage = createStorage({
      arkSettings: {
        providers: {},
        systemPrompt: "Legacy",
        classificationRequirements: "New",
        knowledge: 42,
      },
    });
    await expect(loadSettings(storage)).resolves.toEqual({
      providers: {},
      classificationRequirements: "New",
    });
  });

  it("can clear saved Knowledge without reviving its previous contents", async () => {
    const storage = createStorage();
    await saveProvider(
      storage,
      "openai",
      { apiKey: "key", model: "model" },
      { classificationRequirements: "Rules", knowledge: "Old knowledge" },
    );
    await saveProvider(
      storage,
      "openai",
      { apiKey: "key", model: "model" },
      { classificationRequirements: "Rules", knowledge: "" },
    );
    await expect(loadSettings(storage)).resolves.toMatchObject({
      classificationRequirements: "Rules",
      knowledge: "",
    });
  });

  it("rejects blank requirements without overwriting saved data", async () => {
    const storage = createStorage();
    await expect(
      saveProvider(
        storage,
        "openai",
        { apiKey: "key", model: "model" },
        { classificationRequirements: "  ", knowledge: "Context" },
      ),
    ).rejects.toThrow();
    expect(storage.snapshot()).toEqual({});
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
