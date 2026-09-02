# Model Testing and OpenRouter Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real model-connection tests in Popup and Settings, and stream provider-returned OpenRouter reasoning into a transient Popup panel during organisation.

**Architecture:** Extend the provider boundary with a minimal generation test and an optional reasoning callback. OpenRouter alone switches categorisation to SSE when that callback is supplied; a testable runtime-port adapter carries reasoning and terminal results from the background worker to Popup without changing strict result validation or transactional grouping.

**Tech Stack:** WXT 0.21.4, Chrome Manifest V3 runtime messages and ports, native TypeScript/HTML/CSS, Fetch `ReadableStream`, `TextDecoder`, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-03-model-testing-and-openrouter-reasoning-design.md`

## Global Constraints

- Read `PRODUCT.md`, `DESIGN.md`, the spec, and `.impeccable/surfaces/entrypoints-popup-index-html.md` before implementation.
- Use native TypeScript, HTML, CSS, Fetch streams, and Chrome runtime ports; add no dependency.
- Display only reasoning text or summaries OpenRouter explicitly returns. Never fabricate chain-of-thought or relabel Ark progress as model thought.
- Do not request or enable reasoning. Hide the panel unless at least one displayable fragment arrives.
- Do not store, log, export, or replay reasoning.
- Connection tests send only a fixed minimal instruction, never tab data or the custom categorisation prompt.
- Preserve the direct-to-provider privacy model, 60-second timeout, strict categorisation validation, tab-set recheck, and transactional grouping.
- Raw provider bodies, API keys, and private provider errors must not reach UI messages or logs.
- Keep **Organise tabs** as Popup’s only primary action. Model tests are secondary and may incur a small provider charge.
- Support English and Simplified Chinese, keyboard operation, visible focus, 200% zoom, and the existing 360px Popup width.
- Do not commit unless the user explicitly authorises a local commit.

## Planned File Map

```text
src/providers/types.ts               Provider test method; shared HTTP response/status helpers
src/providers/openai-compatible.ts   Minimal generation test; OpenRouter streamed categorisation
src/providers/anthropic.ts           Minimal Messages API generation test
src/providers/gemini.ts              Minimal generateContent test
src/sse.ts                           Dependency-free, spec-aware SSE data parser
src/model-test.ts                    Saved active-model test coordinator and timeout
src/organise.ts                      Optional reasoning callback propagation
src/messages.ts                      Test-model message and organisation-port protocol
entrypoints/background.ts            Real coordinator and runtime-port bindings
entrypoints/options/index.html       Settings Test model action and cost disclosure
entrypoints/options/main.ts           Test the current unsaved provider draft
entrypoints/options/style.css        Three-control model row and responsive stacking
entrypoints/popup/index.html         Popup Test action and hidden reasoning panel
entrypoints/popup/main.ts             Test state, organisation port, reasoning rendering
entrypoints/popup/style.css          Secondary action and compact reasoning surface
src/popup-state.ts                   Pure testing-state presentation
public/_locales/*/messages.json      Test/reasoning labels and statuses
tests/providers.test.ts              Protocol tests for connection and OpenRouter streaming
tests/sse.test.ts                    Chunk-safe SSE parser tests
tests/model-test.test.ts             Saved settings, permission, timeout, and error tests
tests/organise.test.ts               Reasoning callback propagation
tests/messages.test.ts               Test message and runtime-port behavior
tests/popup-state.test.ts            Testing-state presentation
README.md                            User-facing test/reasoning behavior and cost note
DESIGN.md                            Shipped Popup and Settings control descriptions
```

---

### Task 1: Add Minimal Generation Tests to Every Provider

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/openai-compatible.ts`
- Modify: `src/providers/anthropic.ts`
- Modify: `src/providers/gemini.ts`
- Test: `tests/providers.test.ts`
- Test: `tests/organise.test.ts`

**Interfaces:**

- Consumes: existing `ProviderSettings`, `requestJson`, and provider response extractors.
- Produces: `Provider.testConnection(settings, signal): Promise<void>`.

- [ ] **Step 1: Write failing provider tests**

Add one successful test per protocol family and one empty-response rejection. Reuse the existing `fetchSequence`, `requestAt`, and JSON fixtures:

```ts
it("tests an OpenRouter model with a minimal generation", async () => {
  const fetchMock = fetchSequence(
    jsonResponse({ choices: [{ message: { content: "OK" } }] }),
  );

  await expect(
    getProvider("openrouter", fetchMock).testConnection(
      settings,
      new AbortController().signal,
    ),
  ).resolves.toBeUndefined();

  expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toEqual({
    model: "model-id",
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 8,
    temperature: 0,
  });
});

it("tests an Anthropic model with a minimal generation", async () => {
  const fetchMock = fetchSequence(
    jsonResponse({ content: [{ type: "text", text: "OK" }] }),
  );
  await getProvider("anthropic", fetchMock).testConnection(
    settings,
    new AbortController().signal,
  );
  expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
    model: "model-id",
    max_tokens: 8,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
});

it("tests a Gemini model with a minimal generation", async () => {
  const fetchMock = fetchSequence(
    jsonResponse({
      candidates: [{ content: { parts: [{ text: "OK" }] } }],
    }),
  );
  await getProvider("gemini", fetchMock).testConnection(
    settings,
    new AbortController().signal,
  );
  expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
    contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
    generationConfig: { maxOutputTokens: 8, temperature: 0 },
  });
});

it("rejects an empty connection-test response", async () => {
  const provider = getProvider(
    "openrouter",
    fetchSequence(jsonResponse({ choices: [{ message: { content: "" } }] })),
  );
  await expect(
    provider.testConnection(settings, new AbortController().signal),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
```

- [ ] **Step 2: Run the provider tests and verify RED**

Run: `npm test -- tests/providers.test.ts`

Expected: FAIL because `Provider` has no `testConnection` method.

- [ ] **Step 3: Extend the provider interface**

Add to `Provider` in `src/providers/types.ts`:

```ts
testConnection(
  settings: ProviderSettings,
  signal: AbortSignal,
): Promise<void>;
```

- [ ] **Step 4: Implement the OpenAI-compatible test**

Inside `createOpenAICompatibleProvider`, reuse `configFor`, `headers`, `requestJson`, and `completionText`:

```ts
async testConnection(settings, signal) {
  const config = configFor(id, settings);
  const value = await requestJson(
    fetchImpl,
    endpoint(config, config.chatPath),
    {
      method: "POST",
      headers: headers(settings, config),
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        temperature: 0,
      }),
    },
    signal,
  );
  completionText(value);
},
```

`completionText` already rejects missing or empty content with `invalid_response`; keep one source of truth.

- [ ] **Step 5: Implement Anthropic and Gemini tests**

Anthropic:

```ts
async testConnection(settings, signal) {
  const value = await requestJson(
    fetchImpl,
    `${BASE_URL}/messages`,
    {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    },
    signal,
  );
  messageText(value);
},
```

Gemini:

```ts
async testConnection(settings, signal) {
  const model = settings.model.replace(/^models\//, "");
  const value = await requestJson(
    fetchImpl,
    `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: "Reply with OK." }] },
        ],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      }),
    },
    signal,
  );
  candidateText(value);
},
```

- [ ] **Step 6: Run focused and full provider tests**

Update the existing provider fake in `tests/organise.test.ts` so it satisfies the expanded interface:

```ts
function provider(categorise: Provider["categorise"]): Provider {
  return {
    async listModels() {
      return [];
    },
    async testConnection() {},
    categorise,
  };
}
```

Run:

```bash
npm test -- tests/providers.test.ts tests/organise.test.ts
```

Expected: PASS, including existing 401/403/429/timeout mapping.

- [ ] **Step 7: Conditionally commit**

Only with explicit user authorisation:

```bash
git add src/providers tests/providers.test.ts
git commit -m "feat: test provider model connections"
```

---

### Task 2: Coordinate Saved-Model Tests and Runtime Messages

**Files:**

- Create: `src/model-test.ts`
- Create: `tests/model-test.test.ts`
- Modify: `src/messages.ts`
- Modify: `tests/messages.test.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**

- Consumes: `loadSettings`, `hasProviderPermission`, `Provider.testConnection`.
- Produces: `testActiveModel(deps): Promise<void>` and runtime message `{type:"testModel"}`.

- [ ] **Step 1: Write failing coordinator tests**

Create `tests/model-test.test.ts` with in-memory storage and provider fakes:

```ts
import { describe, expect, it, vi } from "vitest";
import { testActiveModel } from "../src/model-test";

it("tests the saved active provider without reading tabs", async () => {
  const testConnection = vi.fn(async () => {});
  await testActiveModel({
    storage: storageWith({
      activeProvider: "openrouter",
      providers: {
        openrouter: { apiKey: "key", model: "openrouter/free" },
      },
    }),
    permissions: permissions(true),
    providerFor: () => ({
      listModels: async () => [],
      testConnection,
      categorise: async () => {
        throw new Error("must not categorise");
      },
    }),
    timeoutMs: 100,
  });

  expect(testConnection).toHaveBeenCalledWith(
    { apiKey: "key", model: "openrouter/free" },
    expect.any(AbortSignal),
  );
});

it("rejects an unconfigured model before provider selection", async () => {
  await expect(
    testActiveModel({
      storage: storageWith({ providers: {} }),
      permissions: permissions(true),
      providerFor: () => {
        throw new Error("must not select provider");
      },
    }),
  ).rejects.toMatchObject({ code: "not_configured" });
});

it("rejects missing permission without requesting it", async () => {
  await expect(
    testActiveModel(configuredDeps({ permissions: permissions(false) })),
  ).rejects.toMatchObject({ code: "permission_denied" });
});
```

Add a fake-timer test matching `tests/organise.test.ts` that confirms the default signal remains active at 30 seconds and aborts at 60 seconds.

- [ ] **Step 2: Run coordinator tests and verify RED**

Run: `npm test -- tests/model-test.test.ts`

Expected: FAIL because `src/model-test.ts` does not exist.

- [ ] **Step 3: Implement the coordinator**

Create `src/model-test.ts`:

```ts
import type { ProviderId } from "./domain";
import { ArkError } from "./errors";
import { hasProviderPermission, type PermissionsPort } from "./permissions";
import type { Provider } from "./providers/types";
import { loadSettings, type StorageArea } from "./settings";

export type ModelTestDeps = {
  storage: StorageArea;
  permissions: PermissionsPort;
  providerFor(id: ProviderId): Provider;
  timeoutMs?: number;
};

export async function testActiveModel(deps: ModelTestDeps): Promise<void> {
  const stored = await loadSettings(deps.storage);
  const providerId = stored.activeProvider;
  const settings = providerId ? stored.providers[providerId] : undefined;
  if (!providerId || !settings) throw new ArkError("not_configured");
  if (!(await hasProviderPermission(deps.permissions, providerId, settings))) {
    throw new ArkError("permission_denied");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? 60_000,
  );
  try {
    await deps.providerFor(providerId).testConnection(
      settings,
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
}
```

Provider adapters already map an aborted fetch to `timeout`; do not duplicate that mapping here.

- [ ] **Step 4: Write failing runtime-message tests**

Extend `MessageDeps` test fixtures with `testModel`. Add:

```ts
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

it("returns a stable model-test error", async () => {
  const subject = deps({
    testModel: async () => {
      throw new ArkError("forbidden");
    },
  });
  await expect(
    createMessageHandler(subject)({ type: "testModel" }),
  ).resolves.toEqual({ ok: false, errorCode: "forbidden" });
});
```

- [ ] **Step 5: Run message tests and verify RED**

Run: `npm test -- tests/messages.test.ts`

Expected: FAIL because `testModel` is not a runtime message or dependency.

- [ ] **Step 6: Add the message and background binding**

In `src/messages.ts`:

```ts
export type RuntimeMessage =
  | { type: "popupState" }
  | { type: "organise" }
  | { type: "testModel" }
  | { type: "openOptions" }
  | { type: "activateProvider"; provider: ProviderId };
```

Add `testModel(): Promise<void>` to `MessageDeps`. Handle `testModel` before the organise fallback:

```ts
if (message.type === "testModel") {
  try {
    await deps.testModel();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof ArkError ? error.code : "network",
    };
  }
}
```

In `entrypoints/background.ts`, import `testActiveModel` and bind:

```ts
testModel: () =>
  testActiveModel({
    storage,
    permissions,
    providerFor: getProvider,
  }),
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/model-test.test.ts tests/messages.test.ts
```

Expected: PASS.

- [ ] **Step 8: Conditionally commit**

Only with explicit user authorisation:

```bash
git add src/model-test.ts src/messages.ts entrypoints/background.ts tests/model-test.test.ts tests/messages.test.ts
git commit -m "feat: test the active model"
```

---

### Task 3: Parse OpenRouter SSE Without a Dependency

**Files:**

- Create: `src/sse.ts`
- Create: `tests/sse.test.ts`

**Interfaces:**

- Consumes: `ReadableStream<Uint8Array>`.
- Produces: `readSseData(stream): AsyncGenerator<string>`.

- [ ] **Step 1: Write parser tests first**

Create `tests/sse.test.ts`:

```ts
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

it("preserves events split across arbitrary chunks", async () => {
  await expect(
    collect(stream("da", "ta: {\"a\":", "1}\n\n", "data: [DONE]\n\n")),
  ).resolves.toEqual(['{"a":1}', "[DONE]"]);
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

it("flushes a final event without a trailing blank line", async () => {
  await expect(collect(stream("data: final"))).resolves.toEqual(["final"]);
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `npm test -- tests/sse.test.ts`

Expected: FAIL because `src/sse.ts` does not exist.

- [ ] **Step 3: Implement a bounded SSE parser**

Create `src/sse.ts`:

```ts
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
      const value = data.join("\n");
      data = [];
      return value;
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
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const event = consumeLine(line);
        if (event !== undefined) yield event;
      }
      if (done) {
        if (buffer) {
          const event = consumeLine(buffer);
          if (event !== undefined) yield event;
        }
        if (data.length) yield data.join("\n");
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

If the RED test reveals CRLF split handling is incomplete, preserve a trailing `\r` in `buffer` until the next chunk rather than weakening the test.

- [ ] **Step 4: Run parser tests**

Run: `npm test -- tests/sse.test.ts`

Expected: PASS for split frames, comments, multi-line data, CRLF, and final flush.

- [ ] **Step 5: Conditionally commit**

Only with explicit user authorisation:

```bash
git add src/sse.ts tests/sse.test.ts
git commit -m "feat: parse provider event streams"
```

---

### Task 4: Stream OpenRouter Content and Reasoning

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/openai-compatible.ts`
- Modify: `tests/providers.test.ts`
- Consume: `src/sse.ts`

**Interfaces:**

- Consumes: `readSseData`, existing OpenRouter request configuration.
- Produces: optional `onReasoning?: (text: string) => void` on `Provider.categorise`.

- [ ] **Step 1: Write a streamed OpenRouter response helper and failing test**

In `tests/providers.test.ts`:

```ts
function sseResponse(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  const chunks = events
    .map((event) =>
      event === "[DONE]"
        ? "data: [DONE]\n\n"
        : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunks.slice(0, 17)));
        controller.enqueue(encoder.encode(chunks.slice(17)));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

it("streams OpenRouter reasoning while accumulating final JSON", async () => {
  const reasoning: string[] = [];
  const fetchMock = fetchSequence(
    sseResponse(
      {
        choices: [{
          delta: {
            reasoning_details: [
              { type: "reasoning.summary", summary: "Compare subjects. " },
            ],
          },
        }],
      },
      {
        choices: [{
          delta: {
            reasoning_details: [
              { type: "reasoning.text", text: "Keep docs together." },
            ],
            content: categorisationText,
          },
        }],
      },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: {} },
      "[DONE]",
    ),
  );

  await expect(
    getProvider("openrouter", fetchMock).categorise(
      settings,
      tabs,
      "en",
      new AbortController().signal,
      undefined,
      (text) => reasoning.push(text),
    ),
  ).resolves.toEqual(JSON.parse(categorisationText));

  expect(reasoning).toEqual(["Compare subjects. ", "Keep docs together."]);
  expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
    stream: true,
  });
});
```

Add these concrete cases:

```ts
it("supports legacy reasoning and ignores non-displayable details", async () => {
  const reasoning: string[] = [];
  const provider = getProvider(
    "openrouter",
    fetchSequence(
      sseResponse(
        {
          choices: [{
            delta: {
              reasoning: "Legacy thought.",
              reasoning_details: [
                { type: "reasoning.encrypted", data: "ciphertext" },
                { type: "reasoning.text", text: "" },
              ],
              content: categorisationText,
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: {} },
        "[DONE]",
      ),
    ),
  );

  await provider.categorise(
    settings,
    tabs,
    "en",
    new AbortController().signal,
    undefined,
    (text) => reasoning.push(text),
  );
  expect(reasoning).toEqual(["Legacy thought."]);
});

it("maps a mid-stream OpenRouter 403 without exposing its body", async () => {
  const provider = getProvider(
    "openrouter",
    fetchSequence(
      sseResponse(
        { error: { code: 403, message: "private moderation detail" } },
        "[DONE]",
      ),
    ),
  );
  await expect(
    provider.categorise(
      settings,
      tabs,
      "en",
      new AbortController().signal,
      undefined,
      () => {},
    ),
  ).rejects.toMatchObject({ code: "forbidden", message: "forbidden" });
});

it("rejects a stream without final content", async () => {
  const provider = getProvider(
    "openrouter",
    fetchSequence(sseResponse({ choices: [{ delta: {} }] }, "[DONE]")),
  );
  await expect(
    provider.categorise(
      settings,
      tabs,
      "en",
      new AbortController().signal,
      undefined,
      () => {},
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
});

it("keeps direct OpenAI non-streaming when a callback is supplied", async () => {
  const fetchMock = fetchSequence(
    jsonResponse({
      choices: [{ message: { content: categorisationText } }],
    }),
  );
  const onReasoning = vi.fn();
  await getProvider("openai", fetchMock).categorise(
    settings,
    tabs,
    "en",
    new AbortController().signal,
    undefined,
    onReasoning,
  );
  expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).not.toHaveProperty(
    "stream",
  );
  expect(onReasoning).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run provider tests and verify RED**

Run: `npm test -- tests/providers.test.ts`

Expected: FAIL because `categorise` has no reasoning callback and OpenRouter still requests JSON.

- [ ] **Step 3: Extract the shared HTTP response helper**

In `src/providers/types.ts`, add:

```ts
export function arkErrorForStatus(status: number): ArkError {
  if (status === 401) return new ArkError("unauthorised");
  if (status === 403) return new ArkError("forbidden");
  if (status === 408) return new ArkError("timeout");
  if (status === 429) return new ArkError("rate_limited");
  return new ArkError("network");
}

export async function requestResponse(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ArkError("timeout");
    }
    throw new ArkError("network");
  }
  if (!response.ok) throw arkErrorForStatus(response.status);
  return response;
}
```

Refactor `requestJson` to call `requestResponse` and then parse JSON. Run existing provider error tests immediately to ensure mapping is unchanged.

- [ ] **Step 4: Extend `Provider.categorise`**

Append:

```ts
onReasoning?: (text: string) => void,
```

Anthropic and Gemini accept but do not use this final argument. OpenAI and Custom remain non-streaming. Only `id === "openrouter" && onReasoning` selects the streaming branch.

- [ ] **Step 5: Implement OpenRouter stream extraction**

Add focused helpers in `openai-compatible.ts`:

```ts
function reasoningFragments(delta: Record<string, unknown>): string[] {
  const legacy =
    typeof delta.reasoning === "string" && delta.reasoning
      ? [delta.reasoning]
      : [];
  if (!Array.isArray(delta.reasoning_details)) return legacy;
  return [
    ...legacy,
    ...delta.reasoning_details.flatMap((detail) => {
      if (!isRecord(detail)) return [];
      if (detail.type === "reasoning.text" && typeof detail.text === "string") {
        return detail.text ? [detail.text] : [];
      }
      if (
        detail.type === "reasoning.summary" &&
        typeof detail.summary === "string"
      ) {
        return detail.summary ? [detail.summary] : [];
      }
      return [];
    }),
  ];
}
```

Implement:

```ts
async function streamedCompletion(
  response: Response,
  onReasoning: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new ArkError("invalid_response");
  let content = "";
  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") break;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new ArkError("invalid_response");
    }
    if (!isRecord(value)) throw new ArkError("invalid_response");
    if (isRecord(value.error)) {
      const code = Number(value.error.code);
      throw arkErrorForStatus(Number.isFinite(code) ? code : 500);
    }
    const choice = Array.isArray(value.choices) ? value.choices[0] : undefined;
    const delta = isRecord(choice) ? choice.delta : undefined;
    if (!isRecord(delta)) continue;
    for (const text of reasoningFragments(delta)) onReasoning(text);
    if (typeof delta.content === "string") content += delta.content;
  }
  if (!content) throw new ArkError("invalid_response");
  return content;
}
```

The OpenRouter branch uses `requestResponse`, adds `stream: true`, calls `streamedCompletion`, then passes the accumulated content to `parseCategorisation`.

- [ ] **Step 6: Run provider and parser tests**

Run:

```bash
npm test -- tests/sse.test.ts tests/providers.test.ts
```

Expected: PASS without live HTTP requests.

- [ ] **Step 7: Conditionally commit**

Only with explicit user authorisation:

```bash
git add src/providers src/sse.ts tests/providers.test.ts tests/sse.test.ts
git commit -m "feat: stream OpenRouter reasoning"
```

---

### Task 5: Carry Reasoning Through Organisation and a Runtime Port

**Files:**

- Modify: `src/organise.ts`
- Modify: `tests/organise.test.ts`
- Modify: `src/messages.ts`
- Modify: `tests/messages.test.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**

- Consumes: provider `onReasoning` callback and existing `organiseTabs`.
- Produces: `createOrganisePortHandler(deps)` and typed port messages.

- [ ] **Step 1: Write a failing coordinator propagation test**

In `tests/organise.test.ts`:

```ts
it("forwards provider reasoning without changing the result", async () => {
  const reasoning: string[] = [];
  const subject = deps({
    onReasoning: (text) => reasoning.push(text),
    providerFor: () =>
      provider(async (_settings, _tabs, _locale, _signal, _prompt, emit) => {
        emit?.("First thought. ");
        emit?.("Second thought.");
        return {
          groups: [{ name: "Docs", tabIds: ["t0", "t1"] }],
          ungroupedTabIds: [],
        };
      }),
  });

  await organiseTabs(subject);
  expect(reasoning).toEqual(["First thought. ", "Second thought."]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/organise.test.ts`

Expected: FAIL because `OrganiseDeps` and provider calls have no reasoning callback.

- [ ] **Step 3: Propagate the callback**

Add to `OrganiseDeps`:

```ts
onReasoning?: (text: string) => void;
```

Pass `deps.onReasoning` as the last argument to `Provider.categorise`. No other coordinator behavior changes.

- [ ] **Step 4: Write failing runtime-port tests**

Define a structural fake rather than mocking browser globals:

```ts
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
      messageListeners.forEach((listener) => listener({ type: "start" }));
    },
    disconnect() {
      disconnectListeners.forEach((listener) => listener());
    },
  };
}
```

Test:

```ts
it("posts reasoning and completion through the organisation port", async () => {
  const subject = fakePort();
  const handle = createOrganisePortHandler({
    organise: async (onReasoning) => {
      onReasoning("Thinking.");
      return { groupCount: 2, ungroupedCount: 1 };
    },
  });
  handle(subject.port);
  subject.start();
  await vi.waitFor(() =>
    expect(subject.posted).toEqual([
      { type: "reasoning", text: "Thinking." },
      { type: "complete", groupCount: 2, ungroupedCount: 1 },
    ]),
  );
});
```

Add the remaining port cases:

```ts
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
  let emit: ((text: string) => void) | undefined;
  let finish:
    | ((value: { groupCount: number; ungroupedCount: number }) => void)
    | undefined;
  const completed = new Promise<{ groupCount: number; ungroupedCount: number }>(
    (resolve) => {
      finish = resolve;
    },
  );
  createOrganisePortHandler({
    organise: async (onReasoning) => {
      emit = onReasoning;
      return completed;
    },
  })(subject.port);

  subject.start();
  subject.disconnect();
  emit?.("hidden");
  finish?.({ groupCount: 1, ungroupedCount: 0 });
  await completed;
  await Promise.resolve();
  expect(subject.posted).toEqual([]);
});
```

- [ ] **Step 5: Add protocol types and handler**

In `src/messages.ts`:

```ts
export type OrganisePortInbound = { type: "start" };

export type OrganisePortOutbound =
  | { type: "reasoning"; text: string }
  | { type: "complete"; groupCount: number; ungroupedCount: number }
  | { type: "error"; errorCode: ArkErrorCode };

export type OrganisePort = {
  name: string;
  postMessage(message: OrganisePortOutbound): void;
  onMessage: {
    addListener(listener: (message: OrganisePortInbound) => void): void;
  };
  onDisconnect: { addListener(listener: () => void): void };
};

export type OrganisePortDeps = {
  organise(
    onReasoning: (text: string) => void,
  ): Promise<{ groupCount: number; ungroupedCount: number }>;
};
```

`createOrganisePortHandler` tracks `started` and `connected`, posts with:

```ts
function post(message: OrganisePortOutbound): void {
  if (!connected) return;
  try {
    port.postMessage(message);
  } catch {
    connected = false;
  }
}
```

On `start`, call `deps.organise((text) => post({type:"reasoning", text}))`; post `complete` or a stable `error`. Do not abort organisation on disconnect.

- [ ] **Step 6: Bind the real Chrome port**

In `entrypoints/background.ts`:

```ts
const handleOrganisePort = createOrganisePortHandler({
  organise: (onReasoning) =>
    organiseTabs({
      storage,
      permissions,
      tabs,
      providerFor: getProvider,
      locale: browser.i18n.getUILanguage(),
      onReasoning,
    }),
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name === "organise") handleOrganisePort(port);
});
```

Keep the old one-shot `organise` message temporarily until Popup migrates in Task 7; remove it only after the port path passes.

- [ ] **Step 7: Run focused tests and diagnostics**

Run:

```bash
npm test -- tests/organise.test.ts tests/messages.test.ts
```

Then run LSP diagnostics on `src/organise.ts`, `src/messages.ts`, and `entrypoints/background.ts`.

Expected: all pass with no blocking diagnostics.

- [ ] **Step 8: Conditionally commit**

Only with explicit user authorisation:

```bash
git add src/organise.ts src/messages.ts entrypoints/background.ts tests/organise.test.ts tests/messages.test.ts
git commit -m "feat: stream organisation events to popup"
```

---

### Task 6: Add the Settings Test Action

**Files:**

- Modify: `entrypoints/options/index.html`
- Modify: `entrypoints/options/main.ts`
- Modify: `entrypoints/options/style.css`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`

**Interfaces:**

- Consumes: `Provider.testConnection`, `readDraft`, `requestProviderPermission`, `runWithTimeout`, existing status/error mapping.
- Produces: a draft-aware Settings **Test model** action.

- [ ] **Step 1: Add semantic markup**

In the existing `.model-row`, after **Load models**:

```html
<button
  id="test-model"
  class="secondary-button"
  type="button"
  data-i18n="testModel"
>
  Test model
</button>
```

Add below `modelHelp`:

```html
<p class="field-help" data-i18n="modelTestCost">
  Testing sends a minimal generation request and may incur a small charge.
</p>
```

- [ ] **Step 2: Bind the button to the unsaved draft**

In `entrypoints/options/main.ts`:

```ts
const testModelButton = required<HTMLButtonElement>("#test-model");
```

Add:

```ts
testModelButton.addEventListener("click", async () => {
  const providerSettings = readDraft();
  if (
    !providerSettings.apiKey ||
    !providerSettings.model ||
    (selected === "custom" && !providerSettings.baseUrl)
  ) {
    setStatus("invalidSettings", "error");
    return;
  }

  testModelButton.disabled = true;
  loadModelsButton.disabled = true;
  setStatus("testingModel");
  try {
    await requestProviderPermission(permissions, selected, providerSettings);
    await runWithTimeout((signal) =>
      getProvider(selected).testConnection(providerSettings, signal),
    );
    setStatus("modelTestSucceeded", "success");
  } catch (error) {
    setStatus(errorKey(error), "error");
  } finally {
    testModelButton.disabled = false;
    loadModelsButton.disabled = false;
  }
});
```

Change `runWithTimeout` from `30_000` to `60_000` so test and model loading share the application timeout.

- [ ] **Step 3: Add exact locale messages**

English:

```json
"testModel": { "message": "Test model" },
"testingModel": { "message": "Testing model…" },
"modelTestSucceeded": { "message": "Model connection succeeded." },
"modelTestCost": { "message": "Testing sends a minimal generation request and may incur a small charge." }
```

Simplified Chinese:

```json
"testModel": { "message": "测试模型" },
"testingModel": { "message": "正在测试模型…" },
"modelTestSucceeded": { "message": "模型连接成功。" },
"modelTestCost": { "message": "测试会发送一个极小的生成请求，可能产生少量费用。" }
```

- [ ] **Step 4: Preserve responsive layout**

Use:

```css
.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 9px;
}
```

The existing `@media (max-width: 560px)` keeps `grid-template-columns: 1fr`, stacking the input and both buttons with 44px targets.

- [ ] **Step 5: Verify Settings behavior**

Run `npm run typecheck && npm run build`, then inspect Settings at 760px and 390px with a browser API stub or unpacked build. Verify:

- test uses unsaved model text;
- missing fields do not send a request;
- Custom requires Base URL;
- test success and 401/403/429/timeout errors use existing status;
- both actions are disabled during testing;
- keyboard focus and mobile stacking remain correct.

- [ ] **Step 6: Conditionally commit**

Only with explicit user authorisation:

```bash
git add entrypoints/options public/_locales
git commit -m "feat: test model drafts from settings"
```

---

### Task 7: Add Popup Testing and the Reasoning Panel

**Files:**

- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`
- Modify: `src/popup-state.ts`
- Modify: `tests/popup-state.test.ts`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`
- Modify: `src/messages.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**

- Consumes: `{type:"testModel"}` runtime response and `OrganisePortOutbound`.
- Produces: Popup testing state, port-driven organisation, transient reasoning panel.

- [ ] **Step 1: Write the failing pure-state test**

In `tests/popup-state.test.ts`:

```ts
it("disables organisation while testing the model", () => {
  expect(
    popupView({
      kind: "testing",
      count: 8,
      provider: "OpenRouter",
      model: "openrouter/free",
    }),
  ).toMatchObject({
    model: "OpenRouter · openrouter/free",
    buttonKey: "organiseTabs",
    statusKey: "testingModel",
    buttonDisabled: true,
    busy: true,
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/popup-state.test.ts`

Expected: FAIL because `PopupState` has no `testing` variant.

- [ ] **Step 3: Add the testing state**

Add:

```ts
| { kind: "testing"; count: number; provider: string; model: string }
```

Map it before `working`:

```ts
if (state.kind === "testing") {
  return {
    count: state.count,
    model: `${state.provider} · ${state.model}`,
    buttonKey: "organiseTabs",
    statusKey: "testingModel",
    buttonDisabled: true,
    busy: true,
  };
}
```

Add `"testingModel"` to `PopupMessageKey`.

- [ ] **Step 4: Add Popup markup**

Replace the bare select with:

```html
<div class="popup-model-row">
  <select id="active-model" class="active-model" hidden></select>
  <button
    id="test-model"
    class="test-model-button"
    type="button"
    data-i18n="test"
    hidden
  >
    Test
  </button>
</div>
```

Add after the organise button:

```html
<section
  id="reasoning-panel"
  class="reasoning-panel"
  aria-labelledby="reasoning-heading"
  hidden
>
  <h2 id="reasoning-heading" data-i18n="modelReasoning">
    Model reasoning
  </h2>
  <pre id="reasoning-content"></pre>
</section>
```

- [ ] **Step 5: Add Popup model-test behavior**

Define:

```ts
type SimpleResponse =
  | { ok: true }
  | { ok: false; errorCode: ArkErrorCode };
```

On click:

```ts
testModelButton.addEventListener("click", async () => {
  if (!active) return;
  render({
    kind: "testing",
    count: state.count,
    provider: active.provider,
    model: active.model,
  });
  testModelButton.disabled = true;
  try {
    const response = (await browser.runtime.sendMessage({
      type: "testModel",
    })) as SimpleResponse;
    if (!response.ok) {
      render({ kind: "error", count: state.count, code: response.errorCode });
      return;
    }
    render({
      kind: "ready",
      count: state.count,
      provider: active.provider,
      model: active.model,
    });
    statusElement.textContent = msg("modelTestSucceeded");
    statusElement.dataset.kind = "success";
  } catch {
    render({ kind: "error", count: state.count, code: "network" });
  } finally {
    testModelButton.disabled = false;
  }
});
```

`render` must disable the model select and test button for both `testing` and `working`, and show the test button whenever configured model options exist.

- [ ] **Step 6: Replace one-shot organisation with the port**

Add:

```ts
function clearReasoning(): void {
  reasoningContent.textContent = "";
  reasoningPanel.hidden = true;
}

function appendReasoning(text: string): void {
  if (!text) return;
  reasoningPanel.hidden = false;
  reasoningContent.textContent += text;
  reasoningContent.scrollTop = reasoningContent.scrollHeight;
}
```

The organise click opens:

```ts
const port = browser.runtime.connect({ name: "organise" });
let settled = false;

port.onMessage.addListener((message: OrganisePortOutbound) => {
  if (message.type === "reasoning") {
    appendReasoning(message.text);
    return;
  }
  settled = true;
  if (message.type === "complete") {
    render({
      kind: "success",
      count: state.count,
      groupCount: message.groupCount,
      ungroupedCount: message.ungroupedCount,
    });
  } else {
    render({ kind: "error", count: state.count, code: message.errorCode });
  }
  port.disconnect();
});

port.onDisconnect.addListener(() => {
  if (!settled) render({ kind: "error", count: state.count, code: "network" });
});

port.postMessage({ type: "start" });
```

Remove the old Popup `{type:"organise"}` send-message path. After Popup uses the port, remove `{type:"organise"}` from `RuntimeMessage`, the old organise response branch from `createMessageHandler`, and the now-unused `organise` dependency there. Organisation remains available only through the named port.

- [ ] **Step 7: Add exact Popup locale copy**

English:

```json
"test": { "message": "Test" },
"modelReasoning": { "message": "Model reasoning" }
```

Chinese:

```json
"test": { "message": "测试" },
"modelReasoning": { "message": "模型思考" }
```

Reuse `testingModel`, `modelTestSucceeded`, and `modelTestCost` from Task 6.

- [ ] **Step 8: Style the compact controls and panel**

Add:

```css
.popup-model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 12px;
}

.popup-model-row .active-model {
  margin: 0;
}

.test-model-button {
  min-height: 38px;
  padding: 7px 11px;
  border: 1px solid var(--ark-border-strong);
  border-radius: var(--ark-radius-sm);
  color: var(--ark-text);
  background: var(--ark-surface-raised);
  font-size: 12px;
  font-weight: 680;
}

.reasoning-panel {
  margin-top: 11px;
  padding: 10px;
  border: 1px solid var(--ark-border);
  border-radius: var(--ark-radius-sm);
  background: var(--ark-surface-raised);
}

.reasoning-panel h2 {
  margin: 0 0 7px;
  color: var(--ark-muted);
  font-size: 11px;
  font-weight: 700;
}

.reasoning-panel pre {
  max-height: 120px;
  overflow-y: auto;
  margin: 0;
  color: var(--ark-text);
  font: inherit;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

Use the existing shared focus ring; do not add motion, decorative glow, or a token-by-token `aria-live` region.

- [ ] **Step 9: Run focused tests and build**

Run:

```bash
npm test -- tests/popup-state.test.ts tests/messages.test.ts
npm run typecheck
npm run build
```

Expected: PASS with the old one-shot organise message fully removed from Popup and message types.

- [ ] **Step 10: Conditionally commit**

Only with explicit user authorisation:

```bash
git add entrypoints/popup src/popup-state.ts src/messages.ts entrypoints/background.ts public/_locales tests/popup-state.test.ts tests/messages.test.ts
git commit -m "feat: show OpenRouter reasoning in popup"
```

---

### Task 8: Document and Verify the Complete Feature

**Files:**

- Modify: `README.md`
- Modify: `DESIGN.md`
- Review: `docs/superpowers/specs/2026-09-03-model-testing-and-openrouter-reasoning-design.md`
- Generate review evidence only under ignored `.impeccable/review/`

**Interfaces:**

- Consumes: every prior task and the production build.
- Produces: accurate user documentation and release-quality verification evidence.

- [ ] **Step 1: Update user documentation**

README must state:

- Popup tests the saved active model.
- Settings tests the current unsaved draft.
- Tests send a minimal real generation request and may incur a small charge.
- OpenRouter reasoning appears only when the selected model returns displayable reasoning.
- Reasoning is transient and not stored.
- Other providers do not display reasoning in this iteration.

Update `DESIGN.md` so Popup order becomes model selector plus secondary test action, primary organise action, conditional reasoning panel, status, and disclosure. Record the Settings three-control model row and mobile stacking.

- [ ] **Step 2: Run the mechanical detector exactly once**

After all UI edits:

```bash
node /Users/soizoktantas/.pi/agent/skills/impeccable/scripts/detect.mjs --json entrypoints/popup entrypoints/options src/ui/theme.css
```

Fix every actionable finding in one batch. Do not run the detector again.

- [ ] **Step 3: Run one visual inspection batch**

Build and serve `.output/chrome-mv3/` with browser stubs for storage, i18n, runtime messages, runtime ports, and streamed reasoning. Capture:

```text
.impeccable/review/popup-reasoning.png
.impeccable/review/options-test-desktop.png
.impeccable/review/options-test-mobile.png
```

Verify:

- Popup remains 360px wide without clipped controls.
- Long reasoning scrolls inside 120px rather than expanding the Popup indefinitely.
- Test remains secondary to Organise.
- Settings actions stack at 390px.
- English and Chinese expansion fit.
- Keyboard focus is visible.

Make at most one batched correction and one confirmation capture.

- [ ] **Step 4: Run final diagnostics**

Run LSP diagnostics on every changed TypeScript file, then:

```text
lens_diagnostics mode=all
```

Resolve all blocking errors.

- [ ] **Step 5: Run final technical verification**

Run:

```bash
npm run verify
```

Expected: typecheck passes, every Vitest test passes with no warnings or unhandled rejections, and WXT builds `.output/chrome-mv3/`.

- [ ] **Step 6: Run bounded manual Chrome acceptance**

With an unpacked production build:

1. Test a saved OpenRouter model from Popup.
2. Test an unsaved OpenRouter draft from Settings.
3. Repeat Settings tests for OpenAI, Anthropic, Gemini, and Custom when credentials are available.
4. Organise with an OpenRouter model that emits reasoning and confirm incremental text.
5. Organise with `openrouter/free` or a model that emits no reasoning and confirm the panel stays hidden.
6. Trigger 401, 403, 429, timeout, malformed SSE, and mid-stream error fixtures.
7. Close Popup after starting; confirm background grouping still completes safely.
8. Verify reasoning disappears on the next run and after Popup closes.

Do not claim live external-provider coverage for credentials that were not supplied.

- [ ] **Step 7: Conditionally commit**

Only with explicit user authorisation:

```bash
git add README.md DESIGN.md docs/superpowers/specs/2026-09-03-model-testing-and-openrouter-reasoning-design.md docs/superpowers/plans/2026-09-03-model-testing-and-openrouter-reasoning.md src entrypoints public tests
git commit -m "feat: test models and show OpenRouter reasoning"
```
