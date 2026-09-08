# Ark (Tabs Categoriser)

Ark is an MIT-licensed extension for Chrome and desktop Firefox 140+ that uses your own LLM API to organise the current window's non-pinned tabs into native browser tab groups.

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

When you select **Organise tabs**, Ark sends each non-pinned tab's title and full URL, your classification requirements, and all supplied Knowledge directly to your selected provider. It does not read webpage contents. Prompt settings stay in `browser.storage.local`; do not put secrets in Knowledge.

API keys and provider settings are stored in `browser.storage.local` (Chrome's `chrome.storage.local`). This keeps them inside the local browser profile, but it is not a separate encrypted secrets vault. Ark does not sync, proxy, log, or transmit keys anywhere except the selected provider API.

## Permissions

Ark requires:

- `tabs` — read current-window tab titles, URLs, pin state, and group membership.
- `tabGroups` — organise native groups and rename selected existing groups.
- `storage` — keep provider settings locally.

Provider network origins are optional permissions. Ark requests only the selected provider origin from a direct settings-page action. Custom endpoints require HTTPS, except loopback HTTP for `localhost` or `127.0.0.1`.

Firefox's installation prompt also declares required transmission of authentication information (the provider API key) and browsing activity (tab titles and URLs). This is direct-to-provider processing, not Ark analytics. Installing Ark does not grant provider-origin access; that remains a separate settings-page permission.

Firefox [match patterns](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns) cannot include port numbers. For a custom endpoint such as `http://localhost:11434/v1`, its permission covers `http://localhost/*` (all ports on that host), while API requests still use the exact configured port and path. Chrome retains the port-specific permission pattern.

## Local development

Requirements:

- Node.js 22 or newer
- npm
- Chrome or desktop Firefox 140+
- ImageMagick only when regenerating icons

```bash
npm install
npm run dev
```

WXT prints the development extension path. For Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose that path.

For Firefox, use `npm run dev:firefox`. WXT launches Firefox with a temporary development profile and the extension loaded.

## Production build

```bash
npm run verify       # types, tests, Chrome and Firefox production builds
npm run zip          # Chrome ZIP
npm run zip:firefox   # Firefox ZIP
```

Unpacked builds are generated under `.output/chrome-mv3/` and `.output/firefox-mv3/`. WXT creates each distributable ZIP under `.output/`.

To try the Firefox production build, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`. Temporary installs are removed when Firefox exits. The ZIP is unsigned: regular Firefox installation requires Mozilla signing; this repository does not publish or sign it automatically.

### Browser compatibility

Both targets use Manifest V3 and share the same application code. WXT emits a Chrome service worker and Firefox background scripts (a non-persistent event page); do not load the Chrome output in Firefox. Firefox's stable add-on ID is `ark-tabs-categoriser@ark`; keep it unchanged across updates to preserve extension identity.

Native tab-group APIs require Firefox 139+, but Ark requires **140+** to use Firefox's built-in data-transmission consent without a separate legacy consent screen. Firefox for Android is not supported. Existing Chrome settings are not copied into Firefox.

References: [WXT browser targets](https://wxt.dev/guide/essentials/target-different-browsers.html), [Firefox tab groups](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups), and [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Configure a provider

1. Open Ark's settings page.
2. Select a provider.
3. Enter its API key.
4. Load the model list or type a model ID.
5. Edit **Classification requirements**, optionally add **Knowledge**, and review the generated **Final System Prompt**.
6. For Custom, enter the OpenAI-compatible base URL including any version path, such as `https://llm.example/v1`.
7. Save settings and approve access to that API origin.

Open Ark from your browser's toolbar, choose any configured provider/model, and select **Organise tabs**. Long inputs are split automatically when the provider reports a context limit; advanced settings can supply a conservative input token limit for proactive batching. Ark reuses category names across batches, validates that every eligible tab appears exactly once across generated groups and explicitly ungrouped tabs, then confirms the tab set has not changed before modifying groups.

### Background tasks and stopping

Only one organisation task runs at a time. Closing the popup disconnects the
view, not the task; reopening reconnects to its current state and recent
reasoning. The task stays pinned to its original browser window even if focus
changes, including new-group creation and failure recovery. Ark periodically calls a runtime API to keep the background alive only while that task is running.

**Stop** cancels the current model request and prevents further batches or tab
group changes. Cancellation is best-effort at the provider: it cannot undo
charges already incurred. Once browser group changes begin, Stop is briefly
disabled until the commit finishes or failure recovery completes.

Classification and repair requests time out after **120 seconds without incoming
data**, not after a fixed total duration. Response headers, body chunks, and SSE
heartbeats count as activity. Active streams can continue beyond two minutes;
Ark cannot detect thinking that produces no incoming data. Provider/network and
browser lifecycle limits still apply. Model-list and connection-test operations
retain their separate 60-second limit.

A small task summary (state, original window, model, counts, and error code)
lives in `browser.storage.session`, never in synced or durable task history.
Reasoning, tab data, keys, and provider diagnostic text are not included. If the
background unexpectedly restarts with an unfinished task, Ark reports an
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

The Popup also lets you select several existing groups, edit each name, and apply the renames together. If the browser rejects a later rename, Ark restores earlier names where possible.

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
npm run build:firefox
```

Automated provider tests use mocked HTTP responses and never require a real API key or paid request.

For native Firefox checks (Python 3 and an installed desktop Firefox required):

```bash
npm run build:firefox
python3 tests/firefox.browser.py
# For a non-default installation, set FIREFOX_BINARY to the executable path.
```

This optional check uses Firefox's Marionette protocol, a disposable headless profile, synthetic tabs, and a local fake provider. It checks installation metadata, initially ungranted host access, settings save and optional permissions, native groups/colors/window targeting, pinned-tab exclusion, 40 seconds without an extension view, reconnect without resending, renaming, cancellation, and popup task state. It disables the optional-permission confirmation dialog in that test profile only; it does not verify the visible install/consent dialogs, Mozilla signing, every supported Firefox version, or real providers. No personal profile is opened. This check is separate from `npm run verify`.

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
- Targets Chrome and desktop Firefox 140+ with Manifest V3.
- Leaves pinned tabs unchanged.
- Replaces existing group memberships for non-pinned tabs; the model may leave tabs without a useful shared category ungrouped.
- Does not provide schedules, a structured category-rule editor, history, undo history, or cross-device sync.

## Contributing

Keep changes focused, preserve the direct-to-provider privacy model, and include a failing test before changing behavior. Run `npm run verify` before submitting changes.

## License

[MIT](LICENSE)
