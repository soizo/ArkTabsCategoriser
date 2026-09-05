import { defaultSystemPrompt } from "./categorisation";
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
  onReasoning?: (text: string) => void;
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

const encoder = new TextEncoder();

function estimatedInputSize(tabs: TabInput[], systemPrompt: string): number {
  const safeTabs = tabs.map(({ id, title, url }) => ({ id, title, url }));
  return (
    encoder.encode(systemPrompt).length +
    encoder.encode(JSON.stringify(safeTabs)).length
  );
}

function inputTooLong(): ArkError {
  return new ArkError("input_too_long", {
    stage: "request",
    reason: "input_too_long",
    context: "The system prompt or one tab exceeds the model input limit",
  });
}

function splitTabs(tabs: TabInput[]): [TabInput[], TabInput[]] {
  if (tabs.length < 2) throw inputTooLong();
  const sizes = tabs.map(
    ({ id, title, url }) =>
      encoder.encode(JSON.stringify({ id, title, url })).length,
  );
  const target = sizes.reduce((total, size) => total + size, 0) / 2;
  let running = 0;
  let middle = 1;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < tabs.length; index += 1) {
    running += sizes[index - 1] ?? 0;
    const difference = Math.abs(target - running);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      middle = index;
    }
  }
  return [tabs.slice(0, middle), tabs.slice(middle)];
}

function batchesForLimit(
  tabs: TabInput[],
  systemPrompt: string,
  limit: number,
): TabInput[][] {
  const batches: TabInput[][] = [];
  let batch: TabInput[] = [];
  // ponytail: O(n²) sizing is fine for one Chrome window; track byte totals if that ceiling changes.
  for (const tab of tabs) {
    if (estimatedInputSize([...batch, tab], systemPrompt) <= limit) {
      batch.push(tab);
      continue;
    }
    if (!batch.length) throw inputTooLong();
    batches.push(batch);
    batch = [tab];
    if (estimatedInputSize(batch, systemPrompt) > limit) throw inputTooLong();
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function promptWithGroups(
  systemPrompt: string,
  result: Categorisation,
): string {
  if (!result.groups.length) return systemPrompt;
  const names = result.groups.map(({ name }) => name);
  return `${systemPrompt} Earlier batches used these group names: ${JSON.stringify(names)}. Reuse an exact existing name when appropriate. Add at most ${8 - names.length} new group names.`;
}

function mergeCategorisation(
  target: Categorisation,
  source: Categorisation,
): void {
  for (const group of source.groups) {
    const existing = target.groups.find(
      ({ name }) => name.toLocaleLowerCase() === group.name.toLocaleLowerCase(),
    );
    if (existing) {
      existing.tabIds.push(...group.tabIds);
      continue;
    }
    if (target.groups.length === 8) {
      throw new ArkError("invalid_response", {
        stage: "validation",
        reason: "invalid_categorisation",
        context: "Batched categorisation contained more than 8 groups",
      });
    }
    target.groups.push({ ...group, tabIds: [...group.tabIds] });
  }
  target.ungroupedTabIds.push(...source.ungroupedTabIds);
}

async function requestCategorisation(
  deps: OrganiseDeps,
  providerId: ProviderId,
  settings: ProviderSettings,
  tabs: TabInput[],
  systemPrompt?: string,
): Promise<Categorisation> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? 60_000,
  );
  try {
    return await deps
      .providerFor(providerId)
      .categorise(
        settings,
        tabs,
        deps.locale,
        controller.signal,
        systemPrompt,
        deps.onReasoning,
      );
  } catch (error) {
    if (isAbort(error, controller.signal))
      throw new ArkError("timeout", {
        stage: "request",
        reason: "timeout",
      });
    if (error instanceof ArkError) throw error;
    throw new ArkError("network", {
      stage: "request",
      reason: "request_failed",
    });
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
    throw new ArkError("grouping_failed", {
      stage: "grouping",
      reason: "chrome_rejected",
      context: "Chrome rejected a tab-group change",
    });
  }
}

export async function organiseTabs(
  deps: OrganiseDeps,
): Promise<{ groupCount: number; ungroupedCount: number }> {
  const stored = await loadSettings(deps.storage);
  const providerId = stored.activeProvider;
  const settings = providerId ? stored.providers[providerId] : undefined;
  if (!providerId || !settings)
    throw new ArkError("not_configured", {
      stage: "configuration",
      reason: "invalid_configuration",
      context: "No active provider and model were configured",
    });

  if (!(await hasProviderPermission(deps.permissions, providerId, settings))) {
    throw new ArkError("permission_denied", {
      stage: "permission",
      reason: "permission_denied",
    });
  }

  const eligible = eligibleTabs(await deps.tabs.queryCurrentWindow());
  if (eligible.length < 2) return { groupCount: 0, ungroupedCount: 0 };

  const systemPrompt = stored.systemPrompt ?? defaultSystemPrompt(deps.locale);
  const pending = settings.inputTokenLimit
    ? batchesForLimit(eligible, systemPrompt, settings.inputTokenLimit)
    : [eligible];
  const result: Categorisation = { groups: [], ungroupedTabIds: [] };

  while (pending.length) {
    const batch = pending.shift();
    if (!batch) break;
    const prompt = promptWithGroups(systemPrompt, result);
    if (
      settings.inputTokenLimit &&
      estimatedInputSize(batch, prompt) > settings.inputTokenLimit
    ) {
      const [first, second] = splitTabs(batch);
      pending.unshift(first, second);
      continue;
    }
    try {
      mergeCategorisation(
        result,
        await requestCategorisation(deps, providerId, settings, batch, prompt),
      );
    } catch (error) {
      if (!(error instanceof ArkError) || error.code !== "input_too_long") {
        throw error;
      }
      const [first, second] = splitTabs(batch);
      pending.unshift(first, second);
    }
  }

  await applyResult(deps.tabs, eligible, result);
  return {
    groupCount: result.groups.length,
    ungroupedCount: result.ungroupedTabIds.length,
  };
}
