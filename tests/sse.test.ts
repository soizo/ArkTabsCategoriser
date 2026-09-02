import { describe, expect, it } from "vitest";
import { readSseData } from "../src/sse";

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(input: ReadableStream<Uint8Array>): Promise<string[]> {
  const values: string[] = [];
  for await (const value of readSseData(input)) values.push(value);
  return values;
}

describe("readSseData", () => {
  it("preserves events split across arbitrary chunks", async () => {
    await expect(
      collect(stream("da", "ta: {\"a\":", "1}\n\n", "data: [DONE]\n\n")),
    ).resolves.toEqual(['{"a":1}', "[DONE]"]);
  });

  it("preserves UTF-8 characters split across byte chunks", async () => {
    const bytes = new TextEncoder().encode("data: 模型思考\n\n");
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });

    await expect(collect(input)).resolves.toEqual(["模型思考"]);
  });

  it("joins multiple data lines and ignores comments", async () => {
    await expect(
      collect(
        stream(
          ": keep-alive\r\n",
          "event: message\r\n",
          "data: first\r\n",
          "data: second\r\n\r\n",
        ),
      ),
    ).resolves.toEqual(["first\nsecond"]);
  });

  it("handles CRLF split across chunks", async () => {
    await expect(
      collect(stream("data: first\r", "\ndata: second\r", "\n\r", "\n")),
    ).resolves.toEqual(["first\nsecond"]);
  });

  it("flushes a final event without a trailing blank line", async () => {
    await expect(collect(stream("data: final"))).resolves.toEqual(["final"]);
  });
});
