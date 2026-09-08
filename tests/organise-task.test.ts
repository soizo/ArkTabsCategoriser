import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrganisePortHandler,
  type OrganisePortDeps,
  type OrganisePortOutbound,
} from "../src/messages";

function port() {
  let receive = (_message: unknown) => {};
  let disconnect = () => {};
  const posted: OrganisePortOutbound[] = [];
  return {
    name: "organise",
    posted,
    postMessage(message: OrganisePortOutbound) {
      posted.push(message);
    },
    onMessage: {
      addListener(listener: typeof receive) {
        receive = listener;
      },
    },
    onDisconnect: {
      addListener(listener: typeof disconnect) {
        disconnect = listener;
      },
    },
    send(message: unknown) {
      receive(message);
    },
    close() {
      disconnect();
    },
    latest() {
      return posted.filter((message) => message.type === "state").at(-1);
    },
  };
}

function fixture(initial: Record<string, unknown> = {}) {
  let run!: Parameters<OrganisePortDeps["organise"]>[0];
  let finish!: (value: { groupCount: number; ungroupedCount: number }) => void;
  const pending = new Promise<{ groupCount: number; ungroupedCount: number }>(
    (resolve) => {
      finish = resolve;
    },
  );
  const saved = { ...initial };
  const session = {
    get: vi.fn(async () => ({ ...saved })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(saved, structuredClone(value));
    }),
  };
  const keepAlive = vi.fn(async () => {});
  const organise = vi.fn<OrganisePortDeps["organise"]>(async (options) => {
    run = options;
    options.onInfo({ count: 2, provider: "openrouter", model: "test-model" });
    return pending;
  });
  const connect = createOrganisePortHandler({ organise, session, keepAlive });
  return {
    connect,
    organise,
    keepAlive,
    saved,
    session,
    finish,
    run: () => run,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("shared background organisation", () => {
  it("subscribes without starting; shares one pinned task, replay, and completion across popup lifetimes", async () => {
    const f = fixture();
    const first = port();
    f.connect(first);
    await flush();
    expect(f.organise).not.toHaveBeenCalled();
    first.send({ type: "start", windowId: 7 });
    await flush();
    f.run().onReasoning("Thinking");
    first.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.run().signal.aborted).toBe(false);
    expect(f.keepAlive).toHaveBeenCalled();
    const reopened = port();
    f.connect(reopened);
    await flush();
    expect(reopened.latest()).toMatchObject({
      type: "state",
      reasoning: "Thinking",
      task: { phase: "running", windowId: 7 },
    });
    reopened.send({ type: "start", windowId: 99 });
    await flush();
    expect(f.organise).toHaveBeenCalledOnce();
    expect(f.run().windowId).toBe(7);
    const before = first.posted.length;
    f.run().onReasoning(" more");
    f.finish({ groupCount: 1, ungroupedCount: 0 });
    await flush();
    expect(first.posted).toHaveLength(before);
    expect(reopened.latest()).toMatchObject({
      task: { phase: "complete", result: { groupCount: 1 } },
    });
    expect(JSON.stringify(f.saved)).not.toContain("Thinking");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts stop only for the current task and keeps the slot until cancellation settles", async () => {
    const f = fixture();
    const client = port();
    f.connect(client);
    client.send({ type: "start", windowId: 7 });
    await flush();
    const state = client.latest();
    if (state?.type !== "state") throw new Error("Missing snapshot");
    client.send({ type: "stop", id: "stale" });
    expect(f.run().signal.aborted).toBe(false);
    client.send({ type: "stop", id: state.task!.id });
    await flush();
    expect(f.run().signal.aborted).toBe(true);
    client.send({ type: "start", windowId: 8 });
    await flush();
    expect(f.organise).toHaveBeenCalledOnce();
    f.finish({ groupCount: 0, ungroupedCount: 0 });
    await flush();
    expect(client.latest()).toMatchObject({ task: { phase: "cancelled" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not interrupt the commit phase", async () => {
    const f = fixture();
    const client = port();
    f.connect(client);
    client.send({ type: "start", windowId: 7 });
    await flush();
    f.run().onApplying();
    const state = client.latest();
    if (state?.type !== "state") throw new Error("Missing snapshot");
    client.send({ type: "stop", id: state.task!.id });
    await flush();
    expect(f.run().signal.aborted).toBe(false);
    expect(client.latest()).toMatchObject({ task: { phase: "applying" } });
    f.finish({ groupCount: 1, ungroupedCount: 0 });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds reasoning in memory and marks a lost active task interrupted without re-requesting", async () => {
    const f = fixture();
    const client = port();
    f.connect(client);
    client.send({ type: "start", windowId: 7 });
    await flush();
    f.run().onReasoning("x".repeat(100_000));
    const second = port();
    f.connect(second);
    await flush();
    const state = second.latest();
    if (state?.type !== "state") throw new Error("Missing snapshot");
    expect(state.reasoning.length).toBeLessThanOrEqual(64_000);
    const restarted = fixture(f.saved);
    const third = port();
    restarted.connect(third);
    await flush();
    expect(third.latest()).toMatchObject({
      reasoning: "",
      task: { phase: "error", error: { errorCode: "interrupted" } },
    });
    expect(restarted.organise).not.toHaveBeenCalled();
    f.finish({ groupCount: 1, ungroupedCount: 0 });
    await flush();
    const completed = fixture(f.saved);
    const fourth = port();
    completed.connect(fourth);
    await flush();
    expect(fourth.latest()).toMatchObject({
      task: { phase: "complete", result: { groupCount: 1 } },
    });
  });

  it("does not drop an accepted start when the popup closes before session loading finishes", async () => {
    const f = fixture();
    const client = port();
    f.connect(client);
    client.send({ type: "start", windowId: 7 });
    client.close();
    await flush();
    expect(f.organise).toHaveBeenCalledOnce();
    expect(f.run().signal.aborted).toBe(false);
    expect(client.posted).toEqual([]);
    f.finish({ groupCount: 1, ungroupedCount: 0 });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores invalid window IDs and unavailable session storage fails closed before any request", async () => {
    const f = fixture();
    const client = port();
    f.connect(client);
    for (const windowId of [undefined, -1, 1.2, "7"])
      client.send({ type: "start", windowId });
    await flush();
    expect(f.organise).not.toHaveBeenCalled();
    f.session.set.mockRejectedValue(new Error("Storage unavailable"));
    client.send({ type: "start", windowId: 7 });
    await flush();
    expect(f.organise).not.toHaveBeenCalled();
    expect(client.latest()).toMatchObject({ task: { phase: "error" } });
    expect(vi.getTimerCount()).toBe(0);
  });
});
