import type { Categorisation, TabGroupColor, TabInput } from "./domain";
import { ArkError, sanitiseProviderMessage } from "./errors";

export type BrowserTab = {
  id: number;
  windowId: number;
  title?: string;
  url?: string;
  pinned: boolean;
  groupId: number;
};

export type BrowserGroup = {
  id: number;
  title?: string;
  color: TabGroupColor;
  collapsed: boolean;
};

export type TabsPort = {
  queryCurrentWindow(): Promise<BrowserTab[]>;
  queryGroups(windowId: number): Promise<BrowserGroup[]>;
  group(tabIds: number[]): Promise<number>;
  ungroup(tabIds: number[]): Promise<void>;
  updateGroup(
    groupId: number,
    changes: { title?: string; color?: TabGroupColor; collapsed?: boolean },
  ): Promise<void>;
};

type GroupSnapshot = {
  tabIds: number[];
  metadata: Omit<BrowserGroup, "id">;
};

const COLORS: TabGroupColor[] = [
  "purple",
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "grey",
];

function sameTabs(initialTabs: TabInput[], currentTabs: BrowserTab[]): boolean {
  const initial = initialTabs
    .map(({ chromeTabId: id, url }) => ({ id, url }))
    .sort((left, right) => left.id - right.id);
  const current = currentTabs
    .flatMap(({ id, url, pinned }) => (pinned ? [] : [{ id, url: url ?? "" }]))
    .sort((left, right) => left.id - right.id);
  return (
    initial.length === current.length &&
    initial.every((tab, index) => {
      const candidate = current[index];
      return candidate?.id === tab.id && candidate.url === tab.url;
    })
  );
}

async function snapshotGroups(
  port: TabsPort,
  tabs: BrowserTab[],
): Promise<GroupSnapshot[]> {
  const usedIds = new Set(
    tabs.flatMap(({ groupId }) => {
      return groupId === -1 ? [] : [groupId];
    }),
  );
  if (usedIds.size === 0) return [];

  const groups = await port.queryGroups(tabs[0]?.windowId ?? -1);
  return [...usedIds]
    .sort((left, right) => left - right)
    .map((groupId) => {
      const group = groups.find(({ id }) => id === groupId);
      if (!group)
        throw new ArkError("grouping_failed", {
          stage: "grouping",
          reason: "chrome_rejected",
          context: "Chrome did not return existing group metadata",
        });
      const metadata: GroupSnapshot["metadata"] = {
        color: group.color,
        collapsed: group.collapsed,
      };
      if (group.title !== undefined) metadata.title = group.title;
      return {
        tabIds: tabs.flatMap((tab) =>
          tab.groupId === groupId ? [tab.id] : [],
        ),
        metadata,
      };
    });
}

async function restoreGroups(
  port: TabsPort,
  eligibleTabIds: number[],
  snapshot: GroupSnapshot[],
): Promise<void> {
  await port.ungroup(eligibleTabIds);
  for (const original of snapshot) {
    const groupId = await port.group(original.tabIds);
    await port.updateGroup(groupId, original.metadata);
  }
}

export async function renameTabGroups(
  port: TabsPort,
  renames: Array<{ id: number; title: string }>,
): Promise<void> {
  if (renames.length === 0) return;

  const tabs = await port.queryCurrentWindow();
  const windowId = tabs[0]?.windowId;
  const groups = windowId === undefined ? [] : await port.queryGroups(windowId);
  const existing = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<number>();
  const selected = renames.map(({ id, title }) => {
    const group = existing.get(id);
    const nextTitle = title.trim();
    if (!group || seen.has(id) || !nextTitle) {
      throw new ArkError("grouping_failed", {
        stage: "grouping",
        reason: "chrome_rejected",
        context: "A selected tab group is no longer available or has no name",
      });
    }
    seen.add(id);
    return { id, title: nextTitle, previousTitle: group.title ?? "" };
  });
  const updated: typeof selected = [];

  try {
    for (const rename of selected) {
      await port.updateGroup(rename.id, { title: rename.title });
      updated.push(rename);
    }
  } catch {
    for (const rename of updated.toReversed()) {
      try {
        await port.updateGroup(rename.id, { title: rename.previousTitle });
      } catch {
        // Best-effort restoration cannot safely do more after Chrome rejects it.
      }
    }
    throw new ArkError("grouping_failed", {
      stage: "grouping",
      reason: "chrome_rejected",
      context: "Chrome rejected a tab-group rename",
    });
  }
}

export async function applyCategorisation(
  port: TabsPort,
  initialTabs: TabInput[],
  result: Categorisation,
): Promise<void> {
  const currentTabs = await port.queryCurrentWindow();
  if (!sameTabs(initialTabs, currentTabs))
    throw new ArkError("tabs_changed", {
      stage: "validation",
      reason: "tabs_changed",
      context: "Eligible tabs changed before grouping",
    });

  const eligibleTabs = currentTabs.filter(({ pinned }) => !pinned);
  const snapshot = await snapshotGroups(port, eligibleTabs);
  const chromeIds = new Map(
    initialTabs.map(({ id, chromeTabId }) => [id, chromeTabId]),
  );

  const resolveTabIds = (ids: string[]): number[] =>
    ids.map((id) => {
      const chromeTabId = chromeIds.get(id);
      if (chromeTabId === undefined)
        throw new ArkError("grouping_failed", {
          stage: "grouping",
          reason: "chrome_rejected",
          context: "A validated tab could not be resolved",
        });
      return chromeTabId;
    });

  try {
    if (result.ungroupedTabIds.length > 0) {
      await port.ungroup(resolveTabIds(result.ungroupedTabIds));
    }
    for (const [index, category] of result.groups.entries()) {
      const tabIds = resolveTabIds(category.tabIds);
      const groupId = await port.group(tabIds);
      await port.updateGroup(groupId, {
        title: category.name,
        color: category.color ?? COLORS[index % COLORS.length],
      });
    }
  } catch (error) {
    try {
      await restoreGroups(
        port,
        eligibleTabs.map(({ id }) => id),
        snapshot,
      );
    } catch {
      // Best-effort restoration cannot safely do more after Chrome rejects it.
    }
    throw new ArkError("grouping_failed", {
      stage: "grouping",
      reason: "chrome_rejected",
      context:
        sanitiseProviderMessage(error instanceof Error ? error.message : "") ??
        "Chrome rejected a tab-group change",
    });
  }
}
