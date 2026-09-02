import type { Categorisation, ProviderId, TabInput } from "./domain";
import { ArkError } from "./errors";
import {
  applyCategorisation,
  type BrowserTab,
  type TabsPort,
} from "./grouping";
import { hasProviderPermission, type PermissionsPort } from "./permissions";
import type { Provider } from "./providers/types";
import {
  loadSettings,
  type ProviderSettings,
  type StorageArea,
} from "./settings";

export type OrganiseDeps = {
  storage: StorageArea;
  permissions: PermissionsPort;
  tabs: TabsPort;
  providerFor(id: ProviderId): Provider;
  locale: string;
  timeoutMs?: number;
};

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function eligibleTabs(tabs: BrowserTab[]): TabInput[] {
  const eligible: TabInput[] = [];
  for (const tab of tabs) {
    if (tab.pinned) continue;
    eligible.push({
      id: `t${eligible.length}`,
      chromeTabId: tab.id,
      title: tab.title ?? "",
      url: tab.url ?? "",
    });
  }
  return eligible;
}

async function requestCategorisation(
  deps: OrganiseDeps,
  providerId: ProviderId,
  settings: ProviderSettings,
  tabs: TabInput[],
): Promise<Categorisation> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? 30_000,
  );
  try {
    return await deps
      .providerFor(providerId)
      .categorise(settings, tabs, deps.locale, controller.signal);
  } catch (error) {
    if (isAbort(error, controller.signal)) throw new ArkError("timeout");
    if (error instanceof ArkError) throw error;
    throw new ArkError("network");
  } finally {
    clearTimeout(timeout);
  }
}

async function applyResult(
  port: TabsPort,
  tabs: TabInput[],
  result: Categorisation,
): Promise<void> {
  try {
    await applyCategorisation(port, tabs, result);
  } catch (error) {
    if (error instanceof ArkError) throw error;
    throw new ArkError("grouping_failed");
  }
}

export async function organiseTabs(
  deps: OrganiseDeps,
): Promise<{ groupCount: number; ungroupedCount: number }> {
  const stored = await loadSettings(deps.storage);
  const providerId = stored.activeProvider;
  const settings = providerId ? stored.providers[providerId] : undefined;
  if (!providerId || !settings) throw new ArkError("not_configured");

  if (!(await hasProviderPermission(deps.permissions, providerId, settings))) {
    throw new ArkError("permission_denied");
  }

  const eligible = eligibleTabs(await deps.tabs.queryCurrentWindow());
  if (eligible.length < 2) return { groupCount: 0, ungroupedCount: 0 };

  const result = await requestCategorisation(
    deps,
    providerId,
    settings,
    eligible,
  );
  await applyResult(deps.tabs, eligible, result);
  return {
    groupCount: result.groups.length,
    ungroupedCount: result.ungroupedTabIds.length,
  };
}
