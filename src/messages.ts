import type { ProviderId } from "./domain";
import { ArkError, errorPayload, type ArkErrorPayload } from "./errors";
import { isRecord } from "./providers/types";
import type { BrowserGroup, BrowserTab } from "./grouping";
import type { ArkSettings, StorageArea } from "./settings";

type GroupRename = { id: number; title: string };

export type RuntimeMessage =
  | { type: "popupState" }
  | { type: "testModel" }
  | { type: "openOptions" }
  | { type: "activateProvider"; provider: ProviderId }
  | { type: "renameGroups"; renames: GroupRename[] };

export type RuntimeResponse =
  | {
      ok: true;
      count: number;
      provider?: ProviderId;
      model?: string;
      configuredProviders: { provider: ProviderId; model: string }[];
      groups: Array<Pick<BrowserGroup, "id" | "title" | "color">>;
    }
  | { ok: true }
  | ({ ok: false } & ArkErrorPayload);

export type MessageDeps = {
  loadSettings(): Promise<ArkSettings>;
  queryTabs(): Promise<BrowserTab[]>;
  queryGroups(): Promise<BrowserGroup[]>;
  testModel(): Promise<void>;
  openOptions(): Promise<void>;
  activateProvider(provider: ProviderId): Promise<void>;
  renameGroups(renames: GroupRename[]): Promise<void>;
};

export type OrganiseInfo = { count: number; provider: ProviderId; model: string };
export type OrganiseTask = {
  id: string;
  windowId: number;
  startedAt: number;
  phase: "running" | "applying" | "stopping" | "cancelled" | "complete" | "error";
  info?: OrganiseInfo;
  result?: { groupCount: number; ungroupedCount: number };
  error?: ArkErrorPayload;
};

export const REASONING_LIMIT = 64_000;
export type OrganisePortOutbound =
  | { type: "state"; task: OrganiseTask | null; reasoning: string }
  | { type: "reasoning"; text: string };

export type OrganisePort = {
  name: string;
  postMessage(message: OrganisePortOutbound): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
};

export type OrganisePortDeps = {
  organise(options: {
    windowId: number;
    signal: AbortSignal;
    onReasoning: (text: string) => void;
    onApplying: () => void;
    onInfo: (info: OrganiseInfo) => void;
  }): Promise<{ groupCount: number; ungroupedCount: number }>;
  session?: StorageArea;
  keepAlive?: () => Promise<unknown>;
};

export function createMessageHandler(
  deps: MessageDeps,
): (message: RuntimeMessage) => Promise<RuntimeResponse> {
  return async (message) => {
    if (message.type === "popupState") {
      const [settings, tabs, groups] = await Promise.all([
        deps.loadSettings(),
        deps.queryTabs(),
        deps.queryGroups(),
      ]);
      const provider = settings.activeProvider;
      const model = provider ? settings.providers[provider]?.model : undefined;
      const configuredProviders = Object.entries(settings.providers).flatMap(
        ([configuredProvider, configuredSettings]) =>
          configuredSettings
            ? [
                {
                  provider: configuredProvider as ProviderId,
                  model: configuredSettings.model,
                },
              ]
            : [],
      );
      return {
        ok: true,
        count: tabs.filter(({ pinned }) => !pinned).length,
        ...(provider && model ? { provider, model } : {}),
        configuredProviders,
        groups: groups.map(({ id, title, color }) => ({
          id,
          ...(title === undefined ? {} : { title }),
          color,
        })),
      };
    }

    if (message.type === "openOptions") {
      await deps.openOptions();
      return { ok: true };
    }

    if (message.type === "activateProvider") {
      await deps.activateProvider(message.provider);
      return { ok: true };
    }

    if (message.type === "renameGroups") {
      try {
        await deps.renameGroups(message.renames);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          ...errorPayload(error, "grouping_failed", {
            stage: "grouping",
            reason: "chrome_rejected",
          }),
        };
      }
    }

    if (message.type === "testModel") {
      try {
        await deps.testModel();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          ...errorPayload(error, "network", {
            stage: "request",
            reason: "request_failed",
          }),
        };
      }
    }

    return { ok: false, errorCode: "network" };
  };
}

export function createOrganisePortHandler(
  deps: OrganisePortDeps,
): (port: OrganisePort) => void {
  const ports = new Set<OrganisePort>();
  let task: OrganiseTask | null = null;
  let reasoning = "";
  let controller: AbortController | undefined;
  let writes = Promise.resolve();
  let loadError: unknown;

  function post(port: OrganisePort, message: OrganisePortOutbound): void {
    if (!ports.has(port)) return;
    try { port.postMessage(message); } catch { ports.delete(port); }
  }
  function snapshot(): OrganisePortOutbound {
    return { type: "state", task: task ? structuredClone(task) : null, reasoning };
  }
  function broadcast(message = snapshot()): void {
    for (const port of ports) post(port, message);
  }
  function persist(): Promise<void> {
    // No reasoning, tab data, or provider diagnostic text enters session storage.
    const summary = task ? structuredClone(task) : null;
    if (summary?.error) summary.error = { errorCode: summary.error.errorCode };
    writes = writes.catch(() => {}).then(async () => {
      await deps.session?.set({ organiseTask: { version: 1, task: summary } });
    });
    return writes;
  }
  const ready = (async () => {
    try {
      const stored = (await deps.session?.get("organiseTask"))?.organiseTask;
      if (!isRecord(stored) || stored.version !== 1 || !isRecord(stored.task)) return;
      const saved = stored.task;
      if (typeof saved.id !== "string" || !Number.isInteger(saved.windowId) || typeof saved.windowId !== "number" || saved.windowId < 0 || typeof saved.startedAt !== "number" || !Number.isFinite(saved.startedAt) || !["running", "applying", "stopping", "cancelled", "complete", "error"].includes(String(saved.phase))) return;
      task = { id: saved.id, windowId: saved.windowId, startedAt: saved.startedAt, phase: saved.phase as OrganiseTask["phase"] };
      if (isRecord(saved.info) && Number.isInteger(saved.info.count) && typeof saved.info.count === "number" && saved.info.count >= 0 && typeof saved.info.model === "string" && ["openai", "anthropic", "gemini", "openrouter", "custom"].includes(String(saved.info.provider))) {
        task.info = { count: saved.info.count, model: saved.info.model, provider: saved.info.provider as ProviderId };
      }
      if (task.phase === "complete" && isRecord(saved.result) && typeof saved.result.groupCount === "number" && Number.isInteger(saved.result.groupCount) && saved.result.groupCount >= 0 && typeof saved.result.ungroupedCount === "number" && Number.isInteger(saved.result.ungroupedCount) && saved.result.ungroupedCount >= 0) {
        task.result = { groupCount: saved.result.groupCount, ungroupedCount: saved.result.ungroupedCount };
      } else if (task.phase !== "cancelled") {
        // A worker restart cannot resume its old fetch or safely repeat a commit.
        task.phase = "error";
        const code = isRecord(saved.error) ? saved.error.errorCode : undefined;
        const known = ["not_configured", "permission_denied", "unauthorised", "forbidden", "rate_limited", "timeout", "cancelled", "interrupted", "network", "invalid_response", "input_too_long", "tabs_changed", "grouping_failed"];
        task.error = { errorCode: typeof code === "string" && known.includes(code) ? code as ArkErrorPayload["errorCode"] : "interrupted" };
      }
      await persist();
    } catch (error) { loadError = error; }
  })();

  async function start(windowId: number): Promise<void> {
    if (controller) { broadcast(); return; }
    const abort = new AbortController();
    controller = abort;
    task = { id: crypto.randomUUID(), windowId, startedAt: Date.now(), phase: "running" };
    reasoning = "";
    broadcast();
    // Chrome's documented long-operation keepalive, never an idle background loop.
    const keepAlive = setInterval(() => { void deps.keepAlive?.().catch(() => {}); }, 25_000);
    try {
      if (loadError) throw loadError;
      await persist();
      if (abort.signal.aborted) throw new ArkError("cancelled");
      const result = await deps.organise({
        windowId,
        signal: abort.signal,
        onReasoning(text) {
          if (!text || abort.signal.aborted || controller !== abort) return;
          reasoning = (reasoning + text).slice(-REASONING_LIMIT);
          broadcast({ type: "reasoning", text: text.slice(-REASONING_LIMIT) });
        },
        onInfo(info) {
          if (abort.signal.aborted || controller !== abort) return;
          task = { ...task!, info };
          broadcast();
          void persist().catch(() => {});
        },
        onApplying() {
          if (abort.signal.aborted || controller !== abort) throw new ArkError("cancelled");
          task = { ...task!, phase: "applying" };
          broadcast();
          void persist().catch(() => {});
        },
      });
      task = abort.signal.aborted ? { ...task!, phase: "cancelled" } : { ...task!, phase: "complete", result };
      reasoning = "";
    } catch (error) {
      task = abort.signal.aborted
        ? { ...task!, phase: "cancelled" }
        : { ...task!, phase: "error", error: errorPayload(error, "network", { stage: "transport", reason: "request_failed" }) };
    } finally {
      await persist().catch(() => {});
      clearInterval(keepAlive);
      controller = undefined;
      broadcast();
    }
  }

  return (port) => {
    ports.add(port);
    port.onDisconnect.addListener(() => { ports.delete(port); });
    void ready.then(() => post(port, snapshot()));
    port.onMessage.addListener((message) => {
      if (!isRecord(message) || !ports.has(port)) return;
      void ready.then(async () => {
        if (message.type === "start" && typeof message.windowId === "number" && Number.isInteger(message.windowId) && message.windowId >= 0) {
          await start(message.windowId);
        } else if (message.type === "stop" && task?.id === message.id && task?.phase === "running") {
          task = { ...task, phase: "stopping" };
          controller?.abort();
          broadcast();
          void persist().catch(() => {});
        }
      });
    });
  };
}
