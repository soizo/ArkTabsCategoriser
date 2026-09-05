import { describe, expect, it } from "vitest";
import {
  applyCategorisation,
  type BrowserGroup,
  type BrowserTab,
  type TabsPort,
} from "../src/grouping";
import type { Categorisation, TabInput } from "../src/domain";

const initialTabs: TabInput[] = [
  { id: "t0", chromeTabId: 10, title: "Docs", url: "https://example.com/docs" },
  {
    id: "t1",
    chromeTabId: 11,
    title: "Issues",
    url: "https://example.com/issues",
  },
  { id: "t2", chromeTabId: 12, title: "News", url: "https://example.com/news" },
];
const result: Categorisation = {
  groups: [
    { name: "Work", tabIds: ["t0", "t1"] },
    { name: "Read", tabIds: ["t2"] },
  ],
  ungroupedTabIds: [],
};

function browserTabs(): BrowserTab[] {
  return [
    {
      id: 10,
      windowId: 1,
      title: "Docs",
      url: "https://example.com/docs",
      pinned: false,
      groupId: 5,
    },
    {
      id: 11,
      windowId: 1,
      title: "Issues",
      url: "https://example.com/issues",
      pinned: false,
      groupId: 5,
    },
    {
      id: 12,
      windowId: 1,
      title: "News",
      url: "https://example.com/news",
      pinned: false,
      groupId: -1,
    },
    {
      id: 13,
      windowId: 1,
      title: "Pinned",
      url: "https://example.com/pinned",
      pinned: true,
      groupId: -1,
    },
  ];
}

function createTabsPort(
  options: {
    tabs?: BrowserTab[];
    failOnGroupCall?: number;
    failOnUngroup?: boolean;
  } = {},
): TabsPort & {
  tabs: BrowserTab[];
  groups: Map<number, BrowserGroup>;
  mutations: string[];
} {
  const tabs = structuredClone(options.tabs ?? browserTabs());
  const groups = new Map<number, BrowserGroup>([
    [5, { id: 5, title: "Original", color: "blue", collapsed: true }],
  ]);
  const mutations: string[] = [];
  let nextGroupId = 100;
  let groupCalls = 0;

  return {
    tabs,
    groups,
    mutations,
    async queryCurrentWindow() {
      return structuredClone(tabs);
    },
    async queryGroups() {
      return [...groups.values()].map((group) => structuredClone(group));
    },
    async group(tabIds) {
      groupCalls += 1;
      if (groupCalls === options.failOnGroupCall) {
        options.failOnGroupCall = undefined;
        throw new Error("Chrome group failure");
      }
      const groupId = nextGroupId++;
      groups.set(groupId, { id: groupId, color: "grey", collapsed: false });
      for (const tab of tabs) {
        if (tabIds.includes(tab.id)) tab.groupId = groupId;
      }
      mutations.push(`group:${tabIds.join(",")}`);
      return groupId;
    },
    async ungroup(tabIds) {
      for (const tab of tabs) {
        if (tabIds.includes(tab.id)) tab.groupId = -1;
      }
      mutations.push(`ungroup:${tabIds.join(",")}`);
      if (options.failOnUngroup) {
        options.failOnUngroup = false;
        throw new Error("Chrome ungroup failure");
      }
    },
    async updateGroup(groupId, changes) {
      const group = groups.get(groupId);
      if (!group) throw new Error("Unknown group");
      groups.set(groupId, { ...group, ...changes });
      mutations.push(`update:${groupId}`);
    },
  };
}

describe("applyCategorisation", () => {
  it("replaces eligible memberships and applies deterministic group metadata", async () => {
    const port = createTabsPort();

    await applyCategorisation(port, initialTabs, result);

    const workGroup = port.tabs.find(({ id }) => id === 10)?.groupId;
    expect(port.tabs.find(({ id }) => id === 11)?.groupId).toBe(workGroup);
    const readGroup = port.tabs.find(({ id }) => id === 12)?.groupId;
    expect(readGroup).not.toBe(workGroup);
    expect(port.groups.get(workGroup ?? -1)).toMatchObject({
      title: "Work",
      color: "purple",
    });
    expect(port.groups.get(readGroup ?? -1)).toMatchObject({
      title: "Read",
      color: "blue",
    });
  });

  it("uses model-selected colors and falls back to deterministic colors", async () => {
    const port = createTabsPort();

    const coloredResult: Categorisation = {
      groups: [
        { name: "Work", color: "green", tabIds: ["t0", "t1"] },
        { name: "Read", tabIds: ["t2"] },
      ],
      ungroupedTabIds: [],
    };
    await applyCategorisation(port, initialTabs, coloredResult);

    const workGroup = port.tabs.find(({ id }) => id === 10)?.groupId;
    const readGroup = port.tabs.find(({ id }) => id === 12)?.groupId;
    expect(port.groups.get(workGroup ?? -1)?.color).toBe("green");
    expect(port.groups.get(readGroup ?? -1)?.color).toBe("blue");
  });

  it("actively removes model-selected tabs from their previous group", async () => {
    const tabs = browserTabs();
    const tab = tabs.find(({ id }) => id === 12);
    if (tab) tab.groupId = 5;
    const port = createTabsPort({ tabs });

    await applyCategorisation(port, initialTabs, {
      groups: [{ name: "Work", tabIds: ["t0", "t1"] }],
      ungroupedTabIds: ["t2"],
    });

    expect(port.tabs.find(({ id }) => id === 12)?.groupId).toBe(-1);
    expect(port.mutations).toContain("ungroup:12");
  });

  it("does not include pinned tabs in group mutations", async () => {
    const port = createTabsPort();

    await applyCategorisation(port, initialTabs, result);

    expect(port.tabs.find(({ id }) => id === 13)?.groupId).toBe(-1);
    expect(port.mutations.join("|")).not.toContain("13");
  });

  it("aborts before mutation when the eligible tab set changed", async () => {
    const changed = browserTabs();
    const tab = changed.find(({ id }) => id === 11);
    if (tab) tab.url = "https://example.com/replaced";
    const port = createTabsPort({ tabs: changed });

    await expect(
      applyCategorisation(port, initialTabs, result),
    ).rejects.toMatchObject({
      code: "tabs_changed",
      diagnostic: {
        stage: "validation",
        reason: "tabs_changed",
        context: "Eligible tabs changed before grouping",
      },
    });
    expect(port.mutations).toEqual([]);
  });

  it("restores prior memberships when removing a group fails", async () => {
    const tabs = browserTabs();
    const tab = tabs.find(({ id }) => id === 12);
    if (tab) tab.groupId = 5;
    const port = createTabsPort({ tabs, failOnUngroup: true });

    await expect(
      applyCategorisation(port, initialTabs, {
        groups: [{ name: "Work", tabIds: ["t0", "t1"] }],
        ungroupedTabIds: ["t2"],
      }),
    ).rejects.toMatchObject({
      code: "grouping_failed",
      diagnostic: {
        stage: "grouping",
        reason: "chrome_rejected",
        context: "Chrome ungroup failure",
      },
    });

    const restored = port.tabs.find(({ id }) => id === 10)?.groupId;
    expect(restored).not.toBe(-1);
    expect(port.tabs.find(({ id }) => id === 11)?.groupId).toBe(restored);
    expect(port.tabs.find(({ id }) => id === 12)?.groupId).toBe(restored);
  });

  it("restores prior memberships and metadata after a partial Chrome failure", async () => {
    const port = createTabsPort({ failOnGroupCall: 2 });

    await expect(
      applyCategorisation(port, initialTabs, result),
    ).rejects.toMatchObject({
      code: "grouping_failed",
      diagnostic: {
        stage: "grouping",
        reason: "chrome_rejected",
        context: "Chrome group failure",
      },
    });

    const firstOriginal = port.tabs.find(({ id }) => id === 10)?.groupId;
    expect(firstOriginal).not.toBe(-1);
    expect(port.tabs.find(({ id }) => id === 11)?.groupId).toBe(firstOriginal);
    expect(port.tabs.find(({ id }) => id === 12)?.groupId).toBe(-1);
    expect(port.groups.get(firstOriginal ?? -1)).toMatchObject({
      title: "Original",
      color: "blue",
      collapsed: true,
    });
  });
});
