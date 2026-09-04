# Safe Error Console Design

**Date:** 2026-09-05
**Status:** Approved in chat

## 1. Goal

Make every Ark failure understandable without exposing API keys, request bodies, tab data, complete provider responses, or stack traces.

Ark will keep its short translated status message and add a compact diagnostic console in both Popup and Settings. The console will show where the operation failed and safe technical context. In Popup, it will reuse the existing model-reasoning panel and retain any reasoning already shown before an error.

## 2. Scope

### Included

- Safe structured diagnostics for configuration, permission, provider request, provider response, categorisation validation, runtime transport, and Chrome grouping failures.
- Diagnostic transport through model-test runtime messages and the organisation runtime port.
- A shared visual pattern for compact, selectable diagnostic output in Popup and Settings.
- English and Simplified Chinese labels.
- Precise reasons for malformed or incomplete provider responses, including missing completion text.
- Sanitised, bounded provider error messages when a standard error message is available.

### Excluded

- Raw request or response inspection.
- Persistent logs, history, exports, or analytics.
- Stack traces or internal exception objects.
- A developer console, logging service, retry system, or telemetry backend.
- Copy, expand/collapse, filtering, or search controls.

## 3. Error model

Extend `ArkError` with an optional diagnostic:

```ts
type ArkDiagnosticStage =
  | "configuration"
  | "permission"
  | "request"
  | "response"
  | "validation"
  | "transport"
  | "grouping";

type ArkDiagnosticReason =
  | "invalid_configuration"
  | "permission_denied"
  | "request_failed"
  | "timeout"
  | "http_error"
  | "invalid_json"
  | "missing_models"
  | "missing_content"
  | "malformed_stream"
  | "invalid_categorisation"
  | "tabs_changed"
  | "runtime_disconnected"
  | "chrome_rejected";

type ArkDiagnostic = {
  stage: ArkDiagnosticStage;
  reason: ArkDiagnosticReason;
  status?: number;
  origin?: string;
  providerMessage?: string;
  context?: string;
};
```

The existing `ArkErrorCode` remains the stable high-level contract used for translated status messages. Diagnostics add detail; they do not change error handling, retries, transaction boundaries, or recovery behavior.

`context` is application-authored bounded text only. It may identify a missing response field or temporary tab ID, but must never contain a tab title, tab URL, prompt, model output, request body, complete provider response, or stack trace.

## 4. Safety boundary

All data crossing into the UI passes through one error-payload helper. Unknown exceptions become a generic network, transport, or grouping diagnostic selected by the caller's operation boundary.

Provider diagnostics may include:

- HTTP status;
- endpoint origin only, derived with `new URL(url).origin`;
- a short message extracted only from a standard provider JSON error field;
- fixed application-authored context such as `choices[0].message.content was empty`.

Provider messages are normalised before transport:

- remove control characters;
- collapse whitespace;
- remove URLs;
- redact the exact credential values present in request authentication headers;
- redact common bearer/API-key token patterns;
- truncate to a fixed short limit.

Ark never includes request bodies, response bodies, headers, labels or URLs from browser tabs, complete model output, stack traces, or unknown object serialisations. Diagnostics remain in page memory only and disappear when the page closes or a new operation begins.

## 5. Failure coverage

Diagnostics are created at the point with the most precise safe knowledge:

- Settings validation: missing or invalid required configuration.
- Permission helpers: host permission denied.
- HTTP boundary: timeout, transport failure, HTTP status, endpoint origin, and sanitised provider message.
- JSON boundary: response was not valid JSON.
- Provider adapters: missing model list, completion content, Anthropic text content, or Gemini candidate text.
- OpenRouter stream parser: missing body, malformed SSE JSON, provider stream error, or stream ending without final content.
- Categorisation parser: malformed JSON, invalid root, invalid group, unsupported field type, duplicate/missing/unknown temporary tab ID, or too many groups.
- Organisation coordinator: tabs changed during the request.
- Chrome grouping boundary: Chrome rejected grouping/update/restoration.
- Runtime boundary: message failure or unexpected port disconnect.

Where a provider response is structurally invalid, the diagnostic names the expected field rather than exposing the received value.

## 6. Transport

Define a serialisable safe payload:

```ts
type ArkErrorPayload = {
  errorCode: ArkErrorCode;
  diagnostic?: ArkDiagnostic;
};
```

The model-test runtime response becomes `{ ok: false } & ArkErrorPayload`. The organisation port error event becomes `{ type: "error" } & ArkErrorPayload`.

Both paths use the same conversion helper. They never send `Error`, `Response`, arbitrary provider data, or exception messages directly.

Settings catches `ArkError` locally and passes it through the same conversion helper before rendering, so its display contract matches Popup even though it does not cross a runtime boundary.

## 7. Popup console

The current reasoning panel becomes a general output console without adding a second panel.

Behavior:

1. Starting model testing or organisation clears and hides previous output.
2. OpenRouter reasoning reveals the console and appends as it does today.
3. Successful completion preserves the current success behavior and does not create diagnostic output.
4. On failure, existing reasoning remains visible, followed by a visual separator and diagnostic lines.
5. If no reasoning was shown, the error reveals the console by itself.
6. The heading changes from the thinking label to **Output** / **输出** when an error is appended.
7. The short status below the console continues to announce the translated high-level error through its existing polite live region.

Diagnostic content is inserted with `textContent`, remains selectable, scrolls within the existing bounded panel, and is not token-by-token live content.

## 8. Settings console

Settings gains a compact read-only output region adjacent to the existing status area and styled consistently with the Popup console.

- Load models, test model, and save settings clear previous output when a new operation starts.
- Failures show the short translated status plus diagnostic lines.
- Success clears and hides diagnostic output.
- Client-side validation failures receive application-authored diagnostics; no provider request is made.
- Changing provider clears stale output.

No shared component framework is introduced. The two vanilla entrypoints reuse the same presentation rules and error payload, with the minimum local DOM code each requires.

## 9. Localisation

High-level status remains fully translated through existing message keys. Add translated labels for console headings and diagnostic fields such as stage, reason, HTTP status, endpoint, provider message, and context.

Machine values such as status codes, origins, response paths, and temporary tab IDs remain unchanged. Provider-authored messages are displayed as returned after sanitisation and are not machine-translated.

## 10. Testing

Use test-driven development at the real boundaries:

- Error-payload tests verify known and unknown error conversion.
- Sanitisation tests verify URL, control-character, credential, bearer-token, and length redaction.
- Provider tests cover HTTP status/origin/message diagnostics, invalid JSON, missing models, missing content, malformed stream, and content-free stream completion.
- Categorisation tests cover precise safe reasons without exposing received model values.
- Grouping tests cover Chrome rejection while preserving rollback behavior.
- Message tests verify model-test and organisation-port payloads contain only approved serialisable fields.
- Popup presentation tests verify reasoning is retained and diagnostics are appended.
- Settings presentation tests verify failure display and clearing on new/successful operations.
- Locale tests continue to require matching English and Simplified Chinese keys.

Final verification runs language diagnostics, the complete test suite, typecheck, production build, and browser checks for Popup and Settings at their supported widths.

## 11. Files expected to change

- `src/errors.ts`
- `src/providers/types.ts`
- `src/providers/openai-compatible.ts`
- `src/providers/anthropic.ts`
- `src/providers/gemini.ts`
- `src/categorisation.ts`
- `src/grouping.ts`
- `src/organise.ts`
- `src/model-test.ts`
- `src/messages.ts`
- `entrypoints/popup/index.html`
- `entrypoints/popup/main.ts`
- `entrypoints/popup/style.css`
- `entrypoints/options/index.html`
- `entrypoints/options/main.ts`
- `entrypoints/options/style.css`
- `public/_locales/en/messages.json`
- `public/_locales/zh_CN/messages.json`
- Relevant unit and presentation tests

No new runtime dependency is required.
