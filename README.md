# Ark (Tabs Categoriser)

Ark is an MIT-licensed Chrome extension that uses your own LLM API to organise the current window's non-pinned tabs into native Chrome tab groups.

Ark has no model service, proxy, account, analytics, or backend. Requests go directly from the extension to the provider you configure.

## Supported providers

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- Custom OpenAI-compatible APIs

The model field is editable. You can load a provider's model list or type any
model ID directly. Settings lets you edit classification requirements and
optional Knowledge, with a read-only preview of the composed system prompt. Ark normally
sends all eligible tabs together, then automatically retries in smaller batches
if the model reports that its input is too long. An optional advanced input
token limit can make Ark split before sending.

The Popup can test the saved active model. Settings can test the current draft
before it is saved. Each test sends a minimal real generation request and may
incur a small provider charge.

## Privacy

When you select **Organise tabs**, Ark sends each non-pinned tab's title and full URL, your classification requirements, and all supplied Knowledge directly to your selected provider. It does not read webpage contents. Prompt settings stay in `chrome.storage.local`; do not put secrets in Knowledge.

API keys and provider settings are stored in `chrome.storage.local`. This keeps them inside the local Chrome profile, but it is not a separate encrypted secrets vault. Ark does not sync, proxy, log, or transmit keys anywhere except the selected provider API.

## Permissions

Ark requires:

- `tabs` — read current-window tab titles, URLs, pin state, and group membership.
- `tabGroups` — organise native groups and rename selected existing groups.
- `storage` — keep provider settings locally.

Provider network origins are optional permissions. Ark requests only the selected provider origin from a direct settings-page action. Custom endpoints require HTTPS, except loopback HTTP for `localhost` or `127.0.0.1`.

## Local development

Requirements:

- Node.js 22 or newer
- npm
- Chrome
- ImageMagick only when regenerating icons

```bash
npm install
npm run dev
```

WXT prints the development extension path. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose that path.

## Production build

```bash
npm run verify
npm run zip
```

The unpacked build is generated under `.output/chrome-mv3/`. WXT also creates the distributable ZIP.

## Configure a provider

1. Open Ark's settings page.
2. Select a provider.
3. Enter its API key.
4. Load the model list or type a model ID.
5. Edit **Classification requirements**, optionally add **Knowledge**, and review the generated **Final System Prompt**.
6. For Custom, enter the OpenAI-compatible base URL including any version path, such as `https://llm.example/v1`.
7. Save settings and approve access to that API origin.

Open Ark from Chrome's toolbar, choose any configured provider/model, and select **Organise tabs**. Long inputs are split automatically when the provider reports a context limit; advanced settings can supply a conservative input token limit for proactive batching. Ark reuses category names across batches, validates that every eligible tab appears exactly once across generated groups and explicitly ungrouped tabs, then confirms the tab set has not changed before modifying groups.

### Background tasks and stopping

Only one organisation task runs at a time. Closing the popup disconnects the
view, not the task; reopening reconnects to its current state and recent
reasoning. The task stays pinned to its original Chrome window even if focus
changes. Ark keeps the service worker alive only while that task is running.

**Stop** cancels the current model request and prevents further batches or tab
group changes. Cancellation is best-effort at the provider: it cannot undo
charges already incurred. Once Chrome group changes begin, Stop is briefly
disabled until the commit finishes or failure recovery completes.

Classification and repair requests time out after **120 seconds without incoming
data**, not after a fixed total duration. Response headers, body chunks, and SSE
heartbeats count as activity. Active streams can continue beyond two minutes;
Ark cannot detect thinking that produces no incoming data. Provider/network and
Chrome lifecycle limits still apply. Model-list and connection-test operations
retain their separate 60-second limit.

A small task summary (state, original window, model, counts, and error code)
lives in `chrome.storage.session`, never in synced or durable task history.
Reasoning, tab data, keys, and provider diagnostic text are not included. If the
service worker unexpectedly restarts with an unfinished task, Ark reports an
interruption instead of silently resending requests; check the original window
before retrying. Browser restarts do not resume tasks.

Model-load and test progress, results, and errors appear beside the model
controls. Save feedback remains beside Save.

### Classification requirements and Knowledge

These settings are shared by all providers:

- **Classification requirements** starts with editable default grouping and naming rules. **Restore default** affects only these rules, not Knowledge.
- **Knowledge** is optional free text for unfamiliar domains, terminology, and project background. It is sent in full on every batch, without retrieval or truncation, and counts towards the model input limit.
- **Final System Prompt** is a read-only, copyable preview of the current edits. Save settings to use those edits. Runtime batches append existing group context; repair calls use their own protocol with the original classification context.

The prompt gives application constraints priority over classification
requirements, and requirements priority over Knowledge. Knowledge supplies facts,
not instructions. JSON shape and complete, unique tab IDs remain enforced by
local validation regardless of what the model follows.

Existing custom system prompts load verbatim into Classification requirements;
Knowledge starts empty. The next save writes the new settings format.

### Model response recovery

Ark extracts categorisation JSON from plain replies, Markdown code blocks,
`---` separators, and surrounding explanation text. It accepts only one distinct
result that passes complete validation. If multiple valid results remain, it
asks the same model to select a candidate.

For recognisable JSON with syntax or schema errors (including missing or
repeated tab IDs), Ark asks the same model for minimal search/replace edits.
Each search must match exactly once; all edits are checked against the original
candidate and applied together, then the result is validated again. Truncated
JSON can be repaired when its categorisation structure is recognisable. Replies
without a repairable candidate fail immediately; Ark does not regenerate the
whole answer as a fallback.

Each batch allows at most two additional model calls, including candidate
selection and failed patches. Each call starts its own 120-second inactivity
window and may incur a provider charge; there is no fixed total batch deadline.
Repair prompts include the original classification context and candidate text;
repair output is not displayed or persisted. Validation or repair failure stops
the operation before any tab-group changes.

The Popup also lets you select several existing groups, edit each name, and apply the renames together. If Chrome rejects a later rename, Ark restores earlier names where possible.

When OpenRouter returns displayable reasoning while organising, the Popup shows
it as a transient live panel. Structured reasoning takes precedence over the
legacy representation of the same streamed event, without deleting legitimate
repeated words. Ark keeps at most the latest 64,000 characters in worker memory
for reconnection, never writes them to storage or logs, and clears the panel on
success or Stop. It hides the panel when no reasoning is returned and does not
display reasoning from other providers in this iteration.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Automated provider tests use mocked HTTP responses and never require a real API key or paid request.

For options-page interaction checks, serve `.output/chrome-mv3/` locally, open
its `options.html` in Playwright MCP, and run `browser_run_code_unsafe` with the
absolute `filename` of `tests/options.browser.js`. This separate browser check
uses isolated fake extension APIs and credentials, blocks external requests,
and covers prompt migration, preview, copy/error, reset, save/reload/clear,
localisation, keyboard focus, and narrow layouts. Run `tests/task-ui.browser.js`
the same way for contextual model feedback, popup reconnection, stop/commit
states, elapsed time, keyboard focus, and narrow layouts. These browser checks
are not part of `npm test`; they mock extension APIs, not Chrome's actual
service-worker termination policy.

## Limitations

The first release:

- Runs only when the user selects **Organise tabs**.
- Targets Chrome Manifest V3.
- Leaves pinned tabs unchanged.
- Replaces existing group memberships for non-pinned tabs; the model may leave tabs without a useful shared category ungrouped.
- Does not provide schedules, a structured category-rule editor, history, undo history, or cross-device sync.

## Contributing

Keep changes focused, preserve the direct-to-provider privacy model, and include a failing test before changing behavior. Run `npm run verify` before submitting changes.

## License

[MIT](LICENSE)
