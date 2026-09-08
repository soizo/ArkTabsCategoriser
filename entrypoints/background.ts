import { defineBackground } from "wxt/utils/define-background";
import {
  renameTabGroups,
  type BrowserGroup,
  type BrowserTab,
  type TabsPort,
} from "../src/grouping";
import {
  createMessageHandler,
  createOrganisePortHandler,
  type OrganisePort,
  type RuntimeMessage,
} from "../src/messages";
import { testActiveModel } from "../src/model-test";
import { organiseTabs } from "../src/organise";
import type { PermissionsPort } from "../src/permissions";
import { getProvider } from "../src/providers";
import {
  activateProvider,
  loadSettings,
  type StorageArea,
} from "../src/settings";

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

function tabsForWindow(windowId?: number): TabsPort {
  return {
  async queryCurrentWindow(): Promise<BrowserTab[]> {
    const current = await browser.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
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
}
const tabs = tabsForWindow();

export default defineBackground(() => {
  const handleOrganisePort = createOrganisePortHandler({
    organise: ({ windowId, ...run }) => organiseTabs({
      ...run,
      storage,
      permissions,
      tabs: tabsForWindow(windowId),
      providerFor: getProvider,
      locale: browser.i18n.getUILanguage(),
    }),
    session: {
      get: (key) => browser.storage.session.get(key),
      set: (value) => browser.storage.session.set(value),
    },
    keepAlive: () => browser.runtime.getPlatformInfo(),
  });

  const handleMessage = createMessageHandler({
    loadSettings: () => loadSettings(storage),
    queryTabs: () => tabs.queryCurrentWindow(),
    queryGroups: () => tabs.queryGroups(browser.windows.WINDOW_ID_CURRENT),
    testModel: () =>
      testActiveModel({
        storage,
        permissions,
        providerFor: getProvider,
      }),
    openOptions: () => browser.runtime.openOptionsPage(),
    activateProvider: async (provider) => {
      await activateProvider(storage, provider);
    },
    renameGroups: (renames) => renameTabGroups(tabs, renames),
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    return handleMessage(message as RuntimeMessage);
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "organise") {
      handleOrganisePort(port as OrganisePort);
    }
  });
});
