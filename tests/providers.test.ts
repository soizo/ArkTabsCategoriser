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
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).resolves.toEqual(JSON.parse(categorisationText));

    expect(requestAt(fetchMock, 0)[0]).toBe("https://api.openai.com/v1/models");
    const [url, init] = requestAt(fetchMock, 1);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "model-id",
      temperature: 0,
      response_format: { type: "json_object" },
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
  it.each([
    [401, "unauthorised"],
    [403, "unauthorised"],
    [429, "rate_limited"],
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
    ).rejects.toMatchObject({ code });
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
    ).rejects.toMatchObject({ code: "timeout" });
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
    ).rejects.toMatchObject({ code: "network", message: "network" });
  });

  it("rejects an invalid completion shape", async () => {
    const provider = getProvider(
      "openai",
      fetchSequence(jsonResponse({ choices: [] })),
    );
    await expect(
      provider.categorise(settings, tabs, "en", new AbortController().signal),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
