export async function* readSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  function consumeLine(line: string): string | undefined {
    if (!line) {
      if (!data.length) return undefined;
      const event = data.join("\n");
      data = [];
      return event;
    }
    if (line.startsWith(":")) return undefined;
    if (line === "data") data.push("");
    else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
    return undefined;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events: string[] = [];

      while (buffer) {
        const match = /[\r\n]/.exec(buffer);
        if (!match) break;
        const index = match.index;
        if (!done && buffer[index] === "\r" && index === buffer.length - 1) {
          break;
        }
        const width =
          buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        const event = consumeLine(buffer.slice(0, index));
        buffer = buffer.slice(index + width);
        if (event !== undefined) events.push(event);
      }

      if (done) {
        if (buffer) {
          const event = consumeLine(buffer);
          if (event !== undefined) events.push(event);
          buffer = "";
        }
        if (data.length) {
          events.push(data.join("\n"));
          data = [];
        }
      }

      for (const event of events) yield event;
      if (done) break;
    }
  } finally {
    // [DONE], parsing failure, and cancellation must also close the HTTP body.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
