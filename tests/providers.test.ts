import { describe, expect, it, vi } from "vitest";
import { getProvider } from "../src/providers";
import type { Fetch } from "../src/providers/types";
import type { ProviderSettings } from "../src/settings";
import type { TabInput } from "../src/domain";

const settings: ProviderSettings = { apiKey: "secret-key", model: "model-id" };
const tabs: TabInput[] = [
  { id: "t0", chromeTabId: 10, title: "Docs", url: "https://example.com/docs" },
  { id: "t1", chromeTabId: 11, title: "News", url: "https://example.com/news" },
];
const categorisationText = JSON.stringify({
  groups: [
    { name: "Work", tabIds: ["t0"] },
    { name: "Read", tabIds: ["t1"] },
  ],
  ungroupedTabIds: [],
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  const payload = events
    .map((event) =>
      event === "[DONE]"
        ? "data: [DONE]\n\n"
        : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, 17)));
        controller.enqueue(encoder.encode(payload.slice(17)));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function fetchSequence(
  ...responses: Response[]
): ReturnType<typeof vi.fn<Fetch>> {
  return vi.fn<Fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
}

function requestAt(
  fetchMock: ReturnType<typeof vi.fn<Fetch>>,
  index: number,
): [string, RequestInit] {
  const [input, init = {}] = fetchMock.mock.calls[index] ?? [];
  return [String(input), init];
}

describe("OpenAI-compatible providers", () => {
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
      max_tokens: 256,
      temperature: 0,
    });
  });

  it("leaves output room for reasoning models in connection tests", async () => {
    const fetchMock = vi.fn<Fetch>(async (_input, init = {}) => {
      const body = JSON.parse(String(init.body));
      return jsonResponse({
        choices: [
          {
            message: { content: body.max_tokens >= 256 ? "OK" : "" },
            finish_reason: body.max_tokens >= 256 ? "stop" : "length",
          },
        ],
      });
    });

    await expect(
      getProvider("custom", fetchMock).testConnection(
        { ...settings, baseUrl: "https://api.groq.com/openai/v1" },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it("lists and categorises with OpenAI structured output", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({
        data: [{ id: "gpt-z" }, { id: "gpt-a" }, { id: "gpt-a" }],
      }),
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: categorisationText } },
        ],
      }),
    );
    const provider = getProvider("openai", fetchMock);

    await expect(
      provider.listModels(settings, new AbortController().signal),
    ).resolves.toEqual(["gpt-a", "gpt-z"]);
    await expect(
      provider.categorise(
        settings,
        tabs,
        "en",
        new AbortController().signal,
        "My complete prompt",
      ),
    ).resolves.toEqual(JSON.parse(categorisationText));

    expect(requestAt(fetchMock, 0)[0]).toBe("https://api.openai.com/v1/models");
    const [url, init] = requestAt(fetchMock, 1);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "model-id",
      temperature: 0,
      response_format: { type: "json_object" },
    });
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "My complete prompt",
    });
  });

  it("uses OpenRouter headers without forcing structured-output support", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({ data: [{ id: "anthropic/claude-sonnet-4" }] }),
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: categorisationText } },
        ],
      }),
    );
    const provider = getProvider("openrouter", fetchMock);

    await provider.listModels(settings, new AbortController().signal);
    await provider.categorise(
      settings,
      tabs,
      "en",
      new AbortController().signal,
    );

    expect(requestAt(fetchMock, 0)[0]).toBe(
      "https://openrouter.ai/api/v1/models",
    );
    const [url, init] = requestAt(fetchMock, 1);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "X-Title": "Ark (Tabs Categoriser)",
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("response_format");
  });

  it("streams OpenRouter reasoning while accumulating final JSON", async () => {
    const reasoning: string[] = [];
    const fetchMock = fetchSequence(
      sseResponse(
        {
          choices: [
            {
              delta: {
                reasoning_details: [
                  {
                    type: "reasoning.summary",
                    summary: "Compare subjects. ",
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                reasoning_details: [
                  {
                    type: "reasoning.text",
                    text: "Keep docs together.",
                  },
                ],
                content: categorisationText,
              },
            },
          ],
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

  it("supports legacy reasoning and ignores non-displayable details", async () => {
    const reasoning: string[] = [];
    const provider = getProvider(
      "openrouter",
      fetchSequence(
        sseResponse(
          {
            choices: [
              {
                delta: {
                  reasoning: "Legacy thought.",
                  reasoning_details: [
                    { type: "reasoning.encrypted", data: "ciphertext" },
                    { type: "reasoning.text", text: "" },
                  ],
                  content: categorisationText,
                },
              },
            ],
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

  it("rejects an OpenRouter stream without final content", async () => {
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

    expect(
      JSON.parse(String(requestAt(fetchMock, 0)[1].body)),
    ).not.toHaveProperty("stream");
    expect(onReasoning).not.toHaveBeenCalled();
  });

  it("appends compatible paths to a custom versioned base URL", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({ data: [{ id: "local-model" }] }),
      jsonResponse({
        choices: [
          { message: { role: "assistant", content: categorisationText } },
        ],
      }),
    );
    const provider = getProvider("custom", fetchMock);
    const custom = { ...settings, baseUrl: "https://llm.example/v1/" };

    await provider.listModels(custom, new AbortController().signal);
    await provider.categorise(custom, tabs, "en", new AbortController().signal);

    expect(requestAt(fetchMock, 0)[0]).toBe("https://llm.example/v1/models");
    expect(requestAt(fetchMock, 1)[0]).toBe(
      "https://llm.example/v1/chat/completions",
    );
    expect(
      JSON.parse(String(requestAt(fetchMock, 1)[1].body)),
    ).not.toHaveProperty("response_format");
  });
});

describe("Anthropic provider", () => {
  it("tests a model with a minimal generation", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({ content: [{ type: "text", text: "OK" }] }),
    );

    await expect(
      getProvider("anthropic", fetchMock).testConnection(
        settings,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
      model: "model-id",
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with OK." }],
    });
  });

  it("maps model and Messages API responses", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({
        data: [
          {
            id: "claude-sonnet-4",
            display_name: "Claude Sonnet 4",
            type: "model",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude-sonnet-4",
        last_id: "claude-sonnet-4",
      }),
      jsonResponse({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4",
        content: [{ type: "text", text: categorisationText }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
    const provider = getProvider("anthropic", fetchMock);

    await expect(
      provider.listModels(settings, new AbortController().signal),
    ).resolves.toEqual(["claude-sonnet-4"]);
    await expect(
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).resolves.toEqual(JSON.parse(categorisationText));

    expect(requestAt(fetchMock, 0)[0]).toBe(
      "https://api.anthropic.com/v1/models",
    );
    const [url, init] = requestAt(fetchMock, 1);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "secret-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "model-id",
      max_tokens: 2048,
    });
  });
});

describe("Gemini provider", () => {
  it("tests a model with a minimal generation", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      }),
    );

    await expect(
      getProvider("gemini", fetchMock).testConnection(
        settings,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
      generationConfig: { maxOutputTokens: 8, temperature: 0 },
    });
  });

  it("maps model and generateContent responses", async () => {
    const fetchMock = fetchSequence(
      jsonResponse({
        models: [
          {
            name: "models/gemini-2.5-flash",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
      jsonResponse({
        candidates: [
          {
            content: { role: "model", parts: [{ text: categorisationText }] },
            finishReason: "STOP",
          },
        ],
      }),
    );
    const provider = getProvider("gemini", fetchMock);

    await expect(
      provider.listModels(settings, new AbortController().signal),
    ).resolves.toEqual(["gemini-2.5-flash"]);
    await expect(
      provider.categorise(
        settings,
        tabs,
        "zh-CN",
        new AbortController().signal,
      ),
    ).resolves.toEqual(JSON.parse(categorisationText));

    const [url, init] = requestAt(fetchMock, 1);
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/model-id:generateContent",
    );
    expect(init.headers).toMatchObject({ "x-goog-api-key": "secret-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });
  });
});

describe("provider errors", () => {
  it("rejects an empty connection-test response", async () => {
    const provider = getProvider(
      "openrouter",
      fetchSequence(
        jsonResponse({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
        }),
      ),
    );

    await expect(
      provider.testConnection(settings, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "invalid_response",
      diagnostic: {
        stage: "response",
        reason: "missing_content",
        context: "choices[0].message.content was empty; finish_reason=length",
      },
    });
  });

  it.each([
    [401, "unauthorised"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [400, "network"],
    [500, "network"],
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    const provider = getProvider(
      "openai",
      fetchSequence(
        jsonResponse({ error: { message: "private provider text" } }, status),
      ),
    );
    await expect(
      provider.listModels(settings, new AbortController().signal),
    ).rejects.toMatchObject({
      code,
      diagnostic: {
        stage: "response",
        reason: "http_error",
        status,
        origin: "https://api.openai.com",
        providerMessage: "private provider text",
      },
    });
  });

  it("recognises a structured context length error code", async () => {
    const provider = getProvider(
      "openai",
      fetchSequence(
        jsonResponse(
          {
            error: {
              code: "context_length_exceeded",
              message: "Please shorten your messages.",
            },
          },
          400,
        ),
      ),
    );

    await expect(
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).rejects.toMatchObject({ code: "input_too_long" });
  });

  it.each([
    [400, "This model's maximum context length was exceeded"],
    [413, "Request payload too large"],
  ])("recognises HTTP %s input length errors", async (status, message) => {
    const provider = getProvider(
      "openai",
      fetchSequence(jsonResponse({ error: { message } }, status)),
    );

    await expect(
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "input_too_long",
      diagnostic: { stage: "response", status },
    });
  });

  it("reports invalid JSON without exposing the response body", async () => {
    const provider = getProvider(
      "openai",
      fetchSequence(new Response("private non-json body", { status: 200 })),
    );

    await expect(
      provider.listModels(settings, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "invalid_response",
      diagnostic: {
        stage: "response",
        reason: "invalid_json",
        origin: "https://api.openai.com",
      },
    });
  });

  it("maps aborted fetches to timeout", async () => {
    const fetchMock = vi.fn<Fetch>(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      getProvider("openai", fetchMock).listModels(
        settings,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "timeout",
      diagnostic: {
        stage: "request",
        reason: "timeout",
        origin: "https://api.openai.com",
      },
    });
  });

  it("maps other fetch failures to network without exposing their message", async () => {
    const fetchMock = vi.fn<Fetch>(async () => {
      throw new Error("secret network details");
    });
    await expect(
      getProvider("openai", fetchMock).listModels(
        settings,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "network",
      message: "network",
      diagnostic: {
        stage: "request",
        reason: "request_failed",
        origin: "https://api.openai.com",
      },
    });
  });

  it.each([
    ["anthropic", {}, "Expected data to contain a model list"],
    ["gemini", {}, "Expected models to contain a model list"],
  ] as const)(
    "reports a missing %s model list",
    async (providerId, body, context) => {
      await expect(
        getProvider(providerId, fetchSequence(jsonResponse(body))).listModels(
          settings,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: "invalid_response",
        diagnostic: { stage: "response", reason: "missing_models", context },
      });
    },
  );

  it.each([
    ["anthropic", { content: [] }, "Anthropic response text was empty"],
    ["gemini", { candidates: [] }, "Gemini response text was empty"],
  ] as const)(
    "reports missing %s completion content",
    async (providerId, body, context) => {
      await expect(
        getProvider(
          providerId,
          fetchSequence(jsonResponse(body)),
        ).testConnection(settings, new AbortController().signal),
      ).rejects.toMatchObject({
        code: "invalid_response",
        diagnostic: { stage: "response", reason: "missing_content", context },
      });
    },
  );

  it("rejects an invalid completion shape", async () => {
    const provider = getProvider(
      "openai",
      fetchSequence(jsonResponse({ choices: [] })),
    );
    await expect(
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "invalid_response",
      diagnostic: {
        stage: "response",
        reason: "missing_content",
        context: "choices[0].message.content was empty",
      },
    });
  });
});
