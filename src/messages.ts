import type { ProviderId } from "./domain";
import { ArkError, type ArkErrorCode } from "./errors";
import type { BrowserTab } from "./grouping";
import type { ArkSettings } from "./settings";

export type RuntimeMessage =
  | { type: "popupState" }
  | { type: "organise" }
  | { type: "openOptions" };

export type RuntimeResponse =
  | { ok: true; count: number; provider?: ProviderId; model?: string }
  | { ok: true; groupCount: number; ungroupedCount: number }
  | { ok: true }
  | { ok: false; errorCode: ArkErrorCode };

export type MessageDeps = {
  loadSettings(): Promise<ArkSettings>;
  queryTabs(): Promise<BrowserTab[]>;
  organise(): Promise<{ groupCount: number; ungroupedCount: number }>;
  openOptions(): Promise<void>;
};

export function createMessageHandler(
  deps: MessageDeps,
): (message: RuntimeMessage) => Promise<RuntimeResponse> {
  return async (message) => {
    if (message.type === "popupState") {
      const [settings, tabs] = await Promise.all([
        deps.loadSettings(),
        deps.queryTabs(),
      ]);
      const provider = settings.activeProvider;
      const model = provider ? settings.providers[provider]?.model : undefined;
      return {
        ok: true,
        count: tabs.filter(({ pinned }) => !pinned).length,
        ...(provider && model ? { provider, model } : {}),
      };
    }

    if (message.type === "openOptions") {
      await deps.openOptions();
      return { ok: true };
    }

    try {
      const { groupCount, ungroupedCount } = await deps.organise();
      return { ok: true, groupCount, ungroupedCount };
    } catch (error) {
      return {
        ok: false,
        errorCode: error instanceof ArkError ? error.code : "network",
      };
    }
  };
}
