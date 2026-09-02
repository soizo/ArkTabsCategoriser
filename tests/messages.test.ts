import { describe, expect, it, vi } from "vitest";
import { ArkError } from "../src/errors";
import {
  createMessageHandler,
  createOrganisePortHandler,
  type MessageDeps,
} from "../src/messages";
import type { BrowserTab } from "../src/grouping";
import type { ProviderId } from "../src/domain";
import type { ArkSettings } from "../src/settings";

function deps(
  options: {
    settings?: ArkSettings;
    tabs?: BrowserTab[];
    testModel?: () => Promise<void>;
  } = {},
): MessageDeps & { opened: boolean; activated?: ProviderId } {
  const subject: MessageDeps & { opened: boolean; activated?: ProviderId } = {
    opened: false,
    async loadSettings() {
      return options.settings ?? { providers: {} };
    },
    async queryTabs() {
      return options.tabs ?? [];
    },
    testModel: options.testModel ?? (async () => {}),
    async openOptions() {
      subject.opened = true;
    },
    async activateProvider(provider) {
      subject.activated = provider;
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
          openai: { apiKey: "openai-key", model: "gpt-4.1" },
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
      configuredProviders: [
        { provider: "openai", model: "gpt-4.1" },
        { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
      ],
    });
  });

  it("activates a configured provider from the popup", async () => {
    const subject = deps();

    await expect(
      createMessageHandler(subject)({
        type: "activateProvider",
        provider: "gemini",
      }),
    ).resolves.toEqual({ ok: true });
    expect(subject.activated).toBe("gemini");
  });

  it("opens the extension options page", async () => {
    const subject = deps();

    await expect(
      createMessageHandler(subject)({ type: "openOptions" }),
    ).resolves.toEqual({ ok: true });
    expect(subject.opened).toBe(true);
  });

  it("tests the active model", async () => {
    let tested = false;
    const subject = deps({
      testModel: async () => {
        tested = true;
      },
    });

    await expect(
      createMessageHandler(subject)({ type: "testModel" }),
    ).resolves.toEqual({ ok: true });
    expect(tested).toBe(true);
  });

  it("returns only a stable model-test error code", async () => {
    const subject = deps({
      testModel: async () => {
        throw new ArkError("forbidden", "private provider response");
      },
    });

    await expect(
      createMessageHandler(subject)({ type: "testModel" }),
    ).resolves.toEqual({
      ok: false,
      errorCode: "forbidden",
    });
  });
});

function fakePort() {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  return {
    port: {
      name: "organise",
      postMessage(message: unknown) {
        posted.push(message);
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          messageListeners.push(listener);
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.push(listener);
        },
      },
    },
    posted,
    start() {
      for (const listener of messageListeners) listener({ type: "start" });
    },
    disconnect() {
      for (const listener of disconnectListeners) listener();
    },
  };
}

describe("organisation port", () => {
  it("posts reasoning and completion", async () => {
    const subject = fakePort();
    createOrganisePortHandler({
      organise: async (onReasoning) => {
        onReasoning("Thinking.");
        return { groupCount: 2, ungroupedCount: 1 };
      },
    })(subject.port);

    subject.start();

    await vi.waitFor(() =>
      expect(subject.posted).toEqual([
        { type: "reasoning", text: "Thinking." },
        { type: "complete", groupCount: 2, ungroupedCount: 1 },
      ]),
    );
  });

  it("posts only a stable error code", async () => {
    const subject = fakePort();
    createOrganisePortHandler({
      organise: async () => {
        throw new ArkError("forbidden", "private provider detail");
      },
    })(subject.port);

    subject.start();

    await vi.waitFor(() =>
      expect(subject.posted).toEqual([
        { type: "error", errorCode: "forbidden" },
      ]),
    );
  });

  it("starts organisation only once", async () => {
    const subject = fakePort();
    let calls = 0;
    createOrganisePortHandler({
      organise: async () => {
        calls += 1;
        return { groupCount: 1, ungroupedCount: 0 };
      },
    })(subject.port);

    subject.start();
    subject.start();

    await vi.waitFor(() => expect(calls).toBe(1));
  });

  it("continues safely but stops posting after disconnect", async () => {
    const subject = fakePort();
    let emit = (_text: string): void => {};
    let finish = (_value: {
      groupCount: number;
      ungroupedCount: number;
    }): void => {};
    const completed = new Promise<{
      groupCount: number;
      ungroupedCount: number;
    }>((resolve) => {
      finish = resolve;
    });
    createOrganisePortHandler({
      organise: async (onReasoning) => {
        emit = onReasoning;
        return completed;
      },
    })(subject.port);

    subject.start();
    subject.disconnect();
    emit("hidden");
    finish({ groupCount: 1, ungroupedCount: 0 });
    await completed;
    await Promise.resolve();

    expect(subject.posted).toEqual([]);
  });
});
