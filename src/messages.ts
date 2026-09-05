import type { ProviderId } from "./domain";
import { errorPayload, type ArkErrorPayload } from "./errors";
import type { BrowserGroup, BrowserTab } from "./grouping";
import type { ArkSettings } from "./settings";

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

export type OrganisePortOutbound =
  | { type: "reasoning"; text: string }
  | { type: "complete"; groupCount: number; ungroupedCount: number }
  | ({ type: "error" } & ArkErrorPayload);

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
  organise(
    onReasoning: (text: string) => void,
  ): Promise<{ groupCount: number; ungroupedCount: number }>;
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
  return (port) => {
    let connected = true;
    let started = false;

    function post(message: OrganisePortOutbound): void {
      if (!connected) return;
      try {
        port.postMessage(message);
      } catch {
        connected = false;
      }
    }

    port.onDisconnect.addListener(() => {
      connected = false;
    });
    port.onMessage.addListener((message) => {
      if (
        started ||
        typeof message !== "object" ||
        message === null ||
        (message as { type?: unknown }).type !== "start"
      ) {
        return;
      }
      started = true;
      void (async () => {
        try {
          const result = await deps.organise((text) => {
            if (text) post({ type: "reasoning", text });
          });
          post({ type: "complete", ...result });
        } catch (error) {
          post({
            type: "error",
            ...errorPayload(error, "network", {
              stage: "transport",
              reason: "request_failed",
            }),
          });
        }
      })();
    });
  };
}
