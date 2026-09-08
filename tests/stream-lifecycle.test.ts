import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "../src/providers";

const settings = { apiKey: "test-key", model: "test-model" };
const tabs = [{ id: "t0", chromeTabId: 1, title: "Docs", url: "https://example.test" }];
const result = { groups: [{ name: "Docs", tabIds: ["t0"] }], ungroupedTabIds: [] };
const encoder = new TextEncoder();

function streamed() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  const cancel = vi.fn();
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller; },
      cancel,
    }), { headers: { "content-type": "text/event-stream" } });
  });
  return {
    fetchMock, cancel,
    signal: () => signal,
    raw(text: string) { stream.enqueue(encoder.encode(text)); },
    delta(value: unknown) { stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: value }] })}\n\n`)); },
    end() {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`));
      // A provider may leave the HTTP body open after [DONE].
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("classification stream lifecycle", () => {
  it("uses structured reasoning once and preserves real repeated tokens", async () => {
    const stream = streamed();
    const reasoning: string[] = [];
    const pending = getProvider("openrouter", stream.fetchMock).categorise(settings, tabs, "en", new AbortController().signal, undefined, text => reasoning.push(text));
    for (let i = 0; i < 2; i++) stream.delta({ reasoning: "Think ", reasoning_details: [{ type: "reasoning.text", text: "Think " }] });
    stream.end();
    await expect(pending).resolves.toEqual(result);
    expect(reasoning).toEqual(["Think ", "Think "]);
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it("keeps a live stream beyond total deadlines, including heartbeat and partial-event activity", async () => {
    vi.useFakeTimers();
    const stream = streamed();
    const pending = getProvider("openrouter", stream.fetchMock).categorise(settings, tabs, "en", new AbortController().signal, undefined, () => {});
    const assertion = expect(pending).resolves.toEqual(result);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100_000);
      stream.raw(": heartbeat\n\n");
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.signal().aborted).toBe(false);
    }
    stream.raw("data: ");
    await vi.advanceTimersByTimeAsync(100_000);
    stream.raw(JSON.stringify({ choices: [{ delta: { reasoning: "Still here" } }] }) + "\n\n");
    stream.end();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out 120 seconds after the last byte, with no repair call", async () => {
    vi.useFakeTimers();
    const stream = streamed();
    const pending = getProvider("openrouter", stream.fetchMock).categorise(settings, tabs, "en", new AbortController().signal, undefined, () => {});
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100_000);
    stream.delta({ reasoning: "Thinking" });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(stream.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a blocked stream without treating it as a timeout or repairing it", async () => {
    vi.useFakeTimers();
    const stream = streamed();
    const controller = new AbortController();
    const pending = getProvider("openrouter", stream.fetchMock).categorise(settings, tabs, "en", controller.signal, undefined, () => {});
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
