import { describe, expect, it, vi } from "vitest";
import { organiseTabs, type OrganiseDeps } from "../src/organise";
import { ArkError } from "../src/errors";
import type { BrowserGroup, BrowserTab, TabsPort } from "../src/grouping";
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

function tabsPort(
  tabCount = 2,
  title: (index: number) => string = (index) => `Tab ${index}`,
): TabsPort & { groupCalls: number[][] } {
  const tabs: BrowserTab[] = Array.from({ length: tabCount }, (_, index) => ({
    id: index + 10,
    windowId: 1,
    title: title(index),
    url: `https://example.com/${index}`,
    pinned: false,
    groupId: -1,
  }));
  const groups = new Map<number, BrowserGroup>();
  const groupCalls: number[][] = [];
  let nextGroup = 100;
  return {
    groupCalls,
    async queryCurrentWindow() {
      return structuredClone(tabs);
    },
    async queryGroups() {
      return [...groups.values()];
    },
    async group(tabIds) {
      const id = nextGroup++;
      groupCalls.push([...tabIds]);
      groups.set(id, { id, color: "grey", collapsed: false });
      for (const tab of tabs) if (tabIds.includes(tab.id)) tab.groupId = id;
      return id;
    },
    async ungroup(tabIds) {
      for (const tab of tabs) if (tabIds.includes(tab.id)) tab.groupId = -1;
    },
    async updateGroup(groupId, changes) {
      const group = groups.get(groupId);
      if (!group) throw new Error("Unknown group");
      groups.set(groupId, { ...group, ...changes });
    },
  };
}

function configuredSettings(): ArkSettings {
  return {
    activeProvider: "openai",
    providers: { openai: { apiKey: "key", model: "model" } },
  };
}

function provider(categorise: Provider["categorise"]): Provider {
  return {
    async listModels() {
      return [];
    },
    async testConnection() {},
    categorise,
  };
}

function deps(overrides: Partial<OrganiseDeps> = {}): OrganiseDeps {
  return {
    storage: storageWith(configuredSettings()),
    permissions: permissions(),
    tabs: tabsPort(),
    providerFor: () =>
      provider(async (_settings, tabs) => ({
        groups: [
          { name: "First", tabIds: [tabs[0]?.id ?? ""] },
          { name: "Second", tabIds: [tabs[1]?.id ?? ""] },
        ],
        ungroupedTabIds: [],
      })),
    locale: "en",
    timeoutMs: 100,
    ...overrides,
  };
}

describe("organiseTabs", () => {
  it("rejects missing provider configuration before any provider call", async () => {
    let providerCalls = 0;
    const subject = deps({
      storage: storageWith({ providers: {} }),
      providerFor: () => {
        providerCalls += 1;
        return provider(async () => ({ groups: [], ungroupedTabIds: [] }));
      },
    });

    await expect(organiseTabs(subject)).rejects.toMatchObject({
      code: "not_configured",
      diagnostic: {
        stage: "configuration",
        reason: "invalid_configuration",
      },
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects a missing host permission without requesting it", async () => {
    await expect(
      organiseTabs(deps({ permissions: permissions(false) })),
    ).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  it("does not call the provider when fewer than two tabs are eligible", async () => {
    let categoriseCalls = 0;
    const subject = deps({
      tabs: tabsPort(1),
      providerFor: () =>
        provider(async () => {
          categoriseCalls += 1;
          return { groups: [], ungroupedTabIds: [] };
        }),
    });

    await expect(organiseTabs(subject)).resolves.toEqual({
      groupCount: 0,
      ungroupedCount: 0,
    });
    expect(categoriseCalls).toBe(0);
  });

  it("uses stable temporary IDs and the saved prompt", async () => {
    const port = tabsPort();
    let receivedIds: string[] = [];
    let receivedPrompt: string | undefined;
    const subject = deps({
      storage: storageWith({
        ...configuredSettings(),
        systemPrompt: "My complete prompt",
      }),
      tabs: port,
      providerFor: () =>
        provider(async (_settings, tabs, _locale, _signal, systemPrompt) => {
          receivedIds = tabs.map(({ id }) => id);
          receivedPrompt = systemPrompt;
          return {
            groups: [{ name: "First", tabIds: ["t0"] }],
            ungroupedTabIds: ["t1"],
          };
        }),
    });

    await expect(organiseTabs(subject)).resolves.toEqual({
      groupCount: 1,
      ungroupedCount: 1,
    });
    expect(receivedIds).toEqual(["t0", "t1"]);
    expect(receivedPrompt).toBe("My complete prompt");
    expect(port.groupCalls).toEqual([[10]]);
  });

  it("forwards provider reasoning without changing the result", async () => {
    const reasoning: string[] = [];
    const subject = deps({
      onReasoning: (text) => reasoning.push(text),
      providerFor: () =>
        provider(async (_settings, _tabs, _locale, _signal, _prompt, emit) => {
          emit?.("First thought. ");
          emit?.("Second thought.");
          return {
            groups: [{ name: "Docs", tabIds: ["t0", "t1"] }],
            ungroupedTabIds: [],
          };
        }),
    });

    await organiseTabs(subject);
    expect(reasoning).toEqual(["First thought. ", "Second thought."]);
  });

  it("pre-splits requests using the configured input token limit", async () => {
    const received: string[][] = [];
    const subject = deps({
      storage: storageWith({
        activeProvider: "openai",
        providers: {
          openai: {
            apiKey: "key",
            model: "model",
            inputTokenLimit: 500,
          } as ArkSettings["providers"]["openai"],
        },
        systemPrompt: "Sort these tabs.",
      }),
      tabs: tabsPort(4, (index) => `${index}-${"x".repeat(300)}`),
      providerFor: () =>
        provider(async (_settings, tabs) => {
          received.push(tabs.map(({ id }) => id));
          return { groups: [], ungroupedTabIds: tabs.map(({ id }) => id) };
        }),
    });

    await expect(organiseTabs(subject)).resolves.toEqual({
      groupCount: 0,
      ungroupedCount: 4,
    });
    expect(received).toEqual([["t0"], ["t1"], ["t2"], ["t3"]]);
  });

  it("splits an automatically detected oversized request and reuses groups", async () => {
    const received: string[][] = [];
    const subject = deps({
      tabs: tabsPort(2),
      providerFor: () =>
        provider(async (_settings, tabs, _locale, _signal, prompt) => {
          received.push(tabs.map(({ id }) => id));
          if (tabs.length > 1) {
            throw new ArkError("input_too_long" as ArkError["code"]);
          }
          const name =
            tabs[0]?.id === "t0"
              ? "Docs"
              : prompt?.includes('"Docs"')
                ? "Docs"
                : "Other";
          return {
            groups: [{ name, tabIds: [tabs[0]?.id ?? ""] }],
            ungroupedTabIds: [],
          };
        }),
    });

    await expect(organiseTabs(subject)).resolves.toEqual({
      groupCount: 1,
      ungroupedCount: 0,
    });
    expect(received).toEqual([["t0", "t1"], ["t0"], ["t1"]]);
  });

  it("balances automatic splits by input size rather than tab count", async () => {
    const received: string[][] = [];
    const subject = deps({
      tabs: tabsPort(4, (index) =>
        index === 0 ? "x".repeat(800) : `Tab ${index}`,
      ),
      providerFor: () =>
        provider(async (_settings, tabs) => {
          received.push(tabs.map(({ id }) => id));
          if (tabs.length === 4) throw new ArkError("input_too_long");
          return { groups: [], ungroupedTabIds: tabs.map(({ id }) => id) };
        }),
    });

    await organiseTabs(subject);
    expect(received).toEqual([
      ["t0", "t1", "t2", "t3"],
      ["t0"],
      ["t1", "t2", "t3"],
    ]);
  });

  it("stops when one tab is still too large", async () => {
    const port = tabsPort(2);
    const failedProvider = provider(async () => {
      throw new ArkError("input_too_long" as ArkError["code"]);
    });

    await expect(
      organiseTabs(deps({ tabs: port, providerFor: () => failedProvider })),
    ).rejects.toMatchObject({ code: "input_too_long" });
    expect(port.groupCalls).toEqual([]);
  });

  it("rejects more than eight groups across batches before changing tabs", async () => {
    const port = tabsPort(9);
    const subject = deps({
      tabs: port,
      providerFor: () =>
        provider(async (_settings, tabs) => {
          if (tabs.length > 1) {
            throw new ArkError("input_too_long");
          }
          return {
            groups: [
              {
                name: `Group ${tabs[0]?.id}`,
                tabIds: [tabs[0]?.id ?? ""],
              },
            ],
            ungroupedTabIds: [],
          };
        }),
    });

    await expect(organiseTabs(subject)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(port.groupCalls).toEqual([]);
  });

  it("turns an expired request into a timeout without grouping", async () => {
    const port = tabsPort();
    const slowProvider = provider(async (_settings, _tabs, _locale, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
      return { groups: [], ungroupedTabIds: [] };
    });

    await expect(
      organiseTabs(
        deps({ tabs: port, timeoutMs: 1, providerFor: () => slowProvider }),
      ),
    ).rejects.toMatchObject({
      code: "timeout",
      diagnostic: { stage: "request", reason: "timeout" },
    });
    expect(port.groupCalls).toEqual([]);
  });

  it("uses a 60 second timeout by default", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const slowProvider = provider(
      async (_settings, _tabs, _locale, receivedSignal) => {
        signal = receivedSignal;
        await new Promise<void>((_resolve, reject) => {
          receivedSignal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
        return { groups: [], ungroupedTabIds: [] };
      },
    );

    try {
      const subject = deps({ providerFor: () => slowProvider });
      delete subject.timeoutMs;
      const result = expect(organiseTabs(subject)).rejects.toMatchObject({
        code: "timeout",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves provider error codes without grouping", async () => {
    const port = tabsPort();
    const failedProvider = provider(async () => {
      throw new ArkError("rate_limited");
    });

    await expect(
      organiseTabs(deps({ tabs: port, providerFor: () => failedProvider })),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(port.groupCalls).toEqual([]);
  });

  it("hides unexpected provider errors behind the network code", async () => {
    const failedProvider = provider(async () => {
      throw new Error("secret provider details");
    });

    await expect(
      organiseTabs(deps({ providerFor: () => failedProvider })),
    ).rejects.toMatchObject({
      code: "network",
      message: "network",
    });
  });
});
