import { defineBackground } from "wxt/utils/define-background";
import type { BrowserGroup, BrowserTab, TabsPort } from "../src/grouping";
import { createMessageHandler, type RuntimeMessage } from "../src/messages";
import { organiseTabs } from "../src/organise";
import type { PermissionsPort } from "../src/permissions";
import { getProvider } from "../src/providers";
import { loadSettings, type StorageArea } from "../src/settings";

const storage: StorageArea = {
  get: (key) => browser.storage.local.get(key),
  set: (value) => browser.storage.local.set(value),
};

const permissions: PermissionsPort = {
  request: (permission) => browser.permissions.request(permission),
  contains: (permission) => browser.permissions.contains(permission),
};

function hasId(
  tab: Browser.tabs.Tab,
): tab is Browser.tabs.Tab & { id: number } {
  return typeof tab.id === "number";
}

function nonEmptyTabIds(tabIds: number[]): [number, ...number[]] {
  const [first, ...rest] = tabIds;
  if (first === undefined) throw new TypeError("Tab group cannot be empty");
  return [first, ...rest];
}

const tabs: TabsPort = {
  async queryCurrentWindow(): Promise<BrowserTab[]> {
    const current = await browser.tabs.query({ currentWindow: true });
    return current.filter(hasId).map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      ...(tab.title === undefined ? {} : { title: tab.title }),
      ...(tab.url === undefined ? {} : { url: tab.url }),
      pinned: tab.pinned,
      groupId: tab.groupId,
    }));
  },
  async queryGroups(windowId): Promise<BrowserGroup[]> {
    const groups = await browser.tabGroups.query({ windowId });
    return groups.map((group) => ({
      id: group.id,
      ...(group.title === undefined ? {} : { title: group.title }),
      color: group.color,
      collapsed: group.collapsed,
    }));
  },
  group: (tabIds) => browser.tabs.group({ tabIds: nonEmptyTabIds(tabIds) }),
  ungroup: async (tabIds) => {
    await browser.tabs.ungroup(nonEmptyTabIds(tabIds));
  },
  updateGroup: async (groupId, changes) => {
    await browser.tabGroups.update(groupId, changes);
  },
};

export default defineBackground(() => {
  const organise = () =>
    organiseTabs({
      storage,
      permissions,
      tabs,
      providerFor: getProvider,
      locale: browser.i18n.getUILanguage(),
    });

  const handleMessage = createMessageHandler({
    loadSettings: () => loadSettings(storage),
    queryTabs: () => tabs.queryCurrentWindow(),
    organise,
    openOptions: () => browser.runtime.openOptionsPage(),
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    return handleMessage(message as RuntimeMessage);
  });
});
