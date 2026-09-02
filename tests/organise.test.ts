import { describe, expect, it } from "vitest";
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

function tabsPort(tabCount = 2): TabsPort & { groupCalls: number[][] } {
  const tabs: BrowserTab[] = Array.from({ length: tabCount }, (_, index) => ({
    id: index + 10,
    windowId: 1,
    title: `Tab ${index}`,
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

  it("uses stable temporary IDs and applies the provider result", async () => {
    const port = tabsPort();
    let receivedIds: string[] = [];
    const subject = deps({
      tabs: port,
      providerFor: () =>
        provider(async (_settings, tabs) => {
          receivedIds = tabs.map(({ id }) => id);
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
    expect(port.groupCalls).toEqual([[10]]);
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
    ).rejects.toMatchObject({ code: "timeout" });
    expect(port.groupCalls).toEqual([]);
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
