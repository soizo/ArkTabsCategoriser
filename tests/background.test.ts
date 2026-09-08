import { afterEach, expect, it, vi } from "vitest";
import type { OrganisePort, OrganisePortOutbound } from "../src/messages";

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (main: () => void) => ({ main }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("keeps the actual background grouping flow pinned to the starting window after focus changes", async () => {
  let focused = 7;
  let connect!: (port: OrganisePort) => void;
  const response = Promise.withResolvers<Response>();
  const fetchMock = vi.fn<typeof fetch>(async () => response.promise);
  vi.stubGlobal("fetch", fetchMock);
  const query = vi.fn(async ({ windowId }: { windowId?: number }) =>
    [1, 2].map((id) => ({
      id: (windowId ?? focused) * 10 + id,
      windowId: windowId ?? focused,
      pinned: false,
      groupId: -1,
      title: "Docs",
      url: "https://example.test",
    })),
  );
  const group = vi.fn(async () => 42);
  const session = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
  vi.stubGlobal("browser", {
    storage: {
      local: {
        get: async () => ({
          arkSettings: {
            activeProvider: "openai",
            providers: { openai: { apiKey: "test-key", model: "test-model" } },
          },
        }),
        set: vi.fn(),
      },
      session,
    },
    permissions: { contains: async () => true, request: vi.fn() },
    tabs: { query, group, ungroup: vi.fn() },
    tabGroups: { query: async () => [], update: vi.fn() },
    i18n: { getUILanguage: () => "en" },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onConnect: {
        addListener: (listener: typeof connect) => {
          connect = listener;
        },
      },
      getPlatformInfo: async () => ({ os: "mac" }),
    },
  });
  const { default: background } = await import("../entrypoints/background");
  await background.main();
  let receive!: (message: unknown) => void;
  const posted: OrganisePortOutbound[] = [];
  connect({
    name: "organise",
    postMessage: (message) => {
      posted.push(message);
    },
    onMessage: {
      addListener: (listener) => {
        receive = listener;
      },
    },
    onDisconnect: { addListener: vi.fn() },
  });
  receive({ type: "start", windowId: 7 });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  focused = 8;
  response.resolve(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                groups: [{ name: "Docs", tabIds: ["t0", "t1"] }],
                ungroupedTabIds: [],
              }),
            },
          },
        ],
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(
      posted.some(
        (message) =>
          message.type === "state" && message.task?.phase === "complete",
      ),
    ).toBe(true),
  );
  expect(query.mock.calls.length).toBeGreaterThan(1);
  for (const [filter] of query.mock.calls)
    expect(filter).toEqual({ windowId: 7 });
  expect(group).toHaveBeenCalledWith({
    tabIds: [71, 72],
    createProperties: { windowId: 7 },
  });
  expect(JSON.stringify(session.set.mock.calls)).not.toContain("test-key");
  expect(JSON.stringify(session.set.mock.calls)).not.toContain(
    "https://example.test",
  );
});
