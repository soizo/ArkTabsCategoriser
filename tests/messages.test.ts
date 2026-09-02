import { describe, expect, it } from "vitest";
import { ArkError } from "../src/errors";
import { createMessageHandler, type MessageDeps } from "../src/messages";
import type { BrowserTab } from "../src/grouping";
import type { ArkSettings } from "../src/settings";

function deps(
  options: {
    settings?: ArkSettings;
    tabs?: BrowserTab[];
    organise?: MessageDeps["organise"];
  } = {},
): MessageDeps & { opened: boolean } {
  const subject: MessageDeps & { opened: boolean } = {
    opened: false,
    async loadSettings() {
      return options.settings ?? { providers: {} };
    },
    async queryTabs() {
      return options.tabs ?? [];
    },
    organise:
      options.organise ??
      (async () => ({
        groupCount: 2,
        ungroupedCount: 3,
      })),
    async openOptions() {
      subject.opened = true;
    },
  };
  return subject;
}

describe("background messages", () => {
  it("returns eligible count and active model for popup state", async () => {
    const subject = deps({
      settings: {
        activeProvider: "openrouter",
        providers: {
          openrouter: { apiKey: "key", model: "anthropic/claude-sonnet-4" },
        },
      },
      tabs: [
        {
          id: 1,
          windowId: 1,
          pinned: false,
          groupId: -1,
          title: "One",
          url: "https://one.example",
        },
        {
          id: 2,
          windowId: 1,
          pinned: true,
          groupId: -1,
          title: "Pinned",
          url: "https://pinned.example",
        },
      ],
    });

    await expect(
      createMessageHandler(subject)({ type: "popupState" }),
    ).resolves.toEqual({
      ok: true,
      count: 1,
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    });
  });

  it("opens the extension options page", async () => {
    const subject = deps();

    await expect(
      createMessageHandler(subject)({ type: "openOptions" }),
    ).resolves.toEqual({ ok: true });
    expect(subject.opened).toBe(true);
  });

  it("returns the numbers of created groups and ungrouped tabs", async () => {
    await expect(
      createMessageHandler(deps())({ type: "organise" }),
    ).resolves.toEqual({
      ok: true,
      groupCount: 2,
      ungroupedCount: 3,
    });
  });

  it("returns only a stable Ark error code", async () => {
    const subject = deps({
      organise: async () => {
        throw new ArkError("rate_limited", "private provider response");
      },
    });

    await expect(
      createMessageHandler(subject)({ type: "organise" }),
    ).resolves.toEqual({
      ok: false,
      errorCode: "rate_limited",
    });
  });
});
