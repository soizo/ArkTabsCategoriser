# Model Testing and OpenRouter Reasoning Design

**Date:** 2026-09-03  
**Status:** Approved in chat; awaiting written review

## 1. Goal

Add two related diagnostics to Ark:

1. Let users test whether the currently entered or selected model can perform a real generation request.
2. While organising with OpenRouter, show provider-returned reasoning text in a compact Popup panel when the model supplies it.

Ark must never invent reasoning or describe application progress as model thought. The panel displays only reasoning content explicitly returned by OpenRouter.

## 2. Scope

### Included

- A **Test model** action in the Popup for the saved active provider and model.
- A **Test model** action in Settings for the current unsaved provider draft.
- A minimal real-generation request that verifies authentication, model permission, inference availability, and a non-empty model response.
- A streaming OpenRouter categorisation request.
- Incremental display of OpenRouter `reasoning_details` text or summary content.
- Existing strict categorisation validation and safe group application after the stream completes.
- English and Simplified Chinese interface copy.

### Excluded

- Enabling reasoning when a model would not otherwise return it.
- Displaying private or unavailable chain-of-thought.
- Reasoning display for direct OpenAI, Anthropic, Gemini, or Custom providers in this iteration.
- Persisting, logging, exporting, or replaying reasoning.
- A generic chat interface, reasoning history, or background notification system.

## 3. Provider limitation

Reasoning availability is model- and provider-dependent. OpenRouter documents that supported models may return reasoning by default when the model decides to expose it. Dynamic routes such as `openrouter/free` do not advertise a stable reasoning capability.

The Popup therefore:

- remains unchanged when no reasoning is returned;
- creates no placeholder or simulated thought;
- reveals the panel only after the first displayable reasoning fragment arrives.

OpenRouter reasoning details may contain plaintext, summaries, signatures, or encrypted/redacted values. Ark displays only textual reasoning and summary fragments. It ignores signatures, encrypted payloads, and redacted-only blocks.

## 4. Provider interface

Extend the existing provider boundary with:

```ts
type Provider = {
  listModels(...): Promise<string[]>;
  testConnection(
    settings: ProviderSettings,
    signal: AbortSignal,
  ): Promise<void>;
  categorise(
    settings: ProviderSettings,
    tabs: TabInput[],
    locale: string,
    signal: AbortSignal,
    systemPrompt?: string,
    onReasoning?: (text: string) => void,
  ): Promise<Categorisation>;
};
```

### Connection test

Each provider sends a minimal generation request equivalent to **Reply with OK** and requires a non-empty text response.

- It does not read or send browser tabs.
- It does not use the saved custom categorisation prompt.
- It does not apply groups.
- It may incur a small provider charge, which the interface discloses.
- It uses the same authentication, endpoint, model, permission, timeout, and stable error mapping as normal generation.

### OpenRouter categorisation

When `onReasoning` is present, the OpenRouter Chat Completions request adds `stream: true`. Ark parses Server-Sent Events with platform primitives (`ReadableStream`, `TextDecoder`) and no new dependency.

The parser must:

- preserve partial UTF-8 and SSE frames across network chunks;
- support multiple `data:` lines in one event;
- ignore comments and blank keep-alive events;
- recognise `[DONE]`;
- handle the final usage frame with an empty/content-free delta;
- map pre-stream HTTP errors through existing error handling;
- map mid-stream `error` objects without exposing provider bodies;
- append `choices[0].delta.content` to the final categorisation JSON;
- emit displayable text/summary fragments from `choices[0].delta.reasoning_details`.

Non-OpenRouter providers retain their existing non-streaming categorisation behavior and ignore `onReasoning`.

## 5. Background and Popup transport

The current one-shot Popup organisation message becomes a named `runtime.Port` conversation:

```ts
type OrganisePortMessage =
  | { type: "start" }
  | { type: "reasoning"; text: string }
  | { type: "complete"; groupCount: number; ungroupedCount: number }
  | { type: "error"; errorCode: ArkErrorCode };
```

Flow:

1. Popup clears and hides the reasoning panel.
2. Popup opens the organisation port and sends `start`.
3. Background runs the existing organisation coordinator with an `onReasoning` callback.
4. Each OpenRouter reasoning fragment is posted to the port.
5. Final content is validated exactly as today.
6. Background applies groups transactionally and posts `complete`, or posts a stable `error`.

Closing the Popup must not cancel an already paid categorisation request or interrupt safe grouping. Port posting failures are ignored after disconnect; the background operation continues.

The model test remains a one-shot runtime message because it has no incremental output.

## 6. Interface

### Popup

- Place a compact secondary **Test** button beside the model selector.
- Keep **Organise tabs** as the only primary action.
- Disable model selection and testing while organising.
- Disable duplicate test requests while a test is running.
- Report test success or the existing actionable error in the current status region.
- Add a hidden reasoning section below the organising action:
  - heading: **Model reasoning**;
  - restrained bordered surface using existing Ark tokens;
  - fixed maximum height with vertical scrolling;
  - text inserted with `textContent`;
  - automatically follows new content;
  - not exposed as a token-by-token live region.

### Settings

- Keep **Load models** and add a secondary **Test model** action beside the model field.
- Test the current form draft without saving it.
- Request host permission from the button gesture before testing.
- Show success and existing provider errors in the current status region.
- Add helper copy explaining that testing sends a minimal generation request and may incur a small charge.

At narrow widths, model input and both actions stack using the existing responsive layout.

## 7. Error handling

Model tests and streamed organisation preserve current stable errors:

- `unauthorised` for HTTP 401;
- `forbidden` for HTTP 403;
- `rate_limited` for HTTP 429;
- `timeout` after 60 seconds;
- `network` for transport and unclassified HTTP failures;
- `invalid_response` for empty test output, malformed SSE, missing final content, or invalid categorisation JSON.

No raw provider response, API key, or private error message reaches the UI or logs.

## 8. Privacy and cost

Connection testing sends only the fixed test instruction. OpenRouter categorisation continues to send the same eligible-tab titles, URLs, temporary IDs, and system prompt as today.

Reasoning can refer to those tab titles and URLs. It remains transient in Popup memory, is never stored in `chrome.storage`, and disappears when the Popup closes or a new run starts.

## 9. Verification

Automated checks cover:

- connection-test request mapping and non-empty response handling for OpenAI-compatible, Anthropic, and Gemini adapters;
- connection-test 401, 403, 429, timeout, and invalid-response behavior;
- OpenRouter SSE split across arbitrary byte and event boundaries;
- comments, multi-line data, `[DONE]`, usage frames, and mid-stream errors;
- separate accumulation of reasoning and final JSON;
- no reasoning callback for unsupported/non-streaming providers;
- background port reasoning, complete, error, and disconnect behavior;
- Popup/background model-test messaging;
- the existing full categorisation and grouping suite.

Manual Chrome checks cover:

- Popup test of a saved model;
- Settings test of an unsaved draft;
- fee disclosure and disabled states;
- OpenRouter reasoning panel appearing only when reasoning exists;
- no panel for a model without reasoning;
- long reasoning scrolling without Popup overflow;
- English and Simplified Chinese copy;
- keyboard focus and 200% zoom.

## 10. Primary references

- OpenRouter reasoning tokens: <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>
- OpenRouter streaming: <https://openrouter.ai/docs/api/reference/streaming>
- OpenAI reasoning models: <https://platform.openai.com/docs/guides/reasoning>
- Anthropic extended thinking: <https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking>
- Gemini thinking: <https://ai.google.dev/gemini-api/docs/thinking>

