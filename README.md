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
model ID directly. The system prompt is also editable in settings. Ark normally
sends all eligible tabs together, then automatically retries in smaller batches
if the model reports that its input is too long. An optional advanced input
token limit can make Ark split before sending.

The Popup can test the saved active model. Settings can test the current draft
before it is saved. Each test sends a minimal real generation request and may
incur a small provider charge.

## Privacy

When you select **Organise tabs**, Ark sends each non-pinned tab's title and full URL to your selected provider. It does not read webpage contents.

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
5. Edit the system prompt if you want different categorisation instructions.
6. For Custom, enter the OpenAI-compatible base URL including any version path, such as `https://llm.example/v1`.
7. Save settings and approve access to that API origin.

Open Ark from Chrome's toolbar, choose any configured provider/model, and select **Organise tabs**. Long inputs are split automatically when the provider reports a context limit; advanced settings can supply a conservative input token limit for proactive batching. Ark reuses category names across batches, validates that every eligible tab appears exactly once across generated groups and explicitly ungrouped tabs, then confirms the tab set has not changed before modifying groups.

The Popup also lets you select several existing groups, edit each name, and apply the renames together. If Chrome rejects a later rename, Ark restores earlier names where possible.

When OpenRouter returns displayable reasoning while organising, the Popup shows
it as a transient live panel. Ark does not store or log that reasoning, hides
the panel when no reasoning is returned, and does not display reasoning from
other providers in this iteration.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Automated provider tests use mocked HTTP responses and never require a real API key or paid request.

## Limitations

The first release:

- Runs only when the user selects **Organise tabs**.
- Targets Chrome Manifest V3.
- Leaves pinned tabs unchanged.
- Replaces existing group memberships for non-pinned tabs; the model may leave tabs without a useful shared category ungrouped.
- Does not provide schedules, custom category rules, history, undo history, or cross-device sync.

## Contributing

Keep changes focused, preserve the direct-to-provider privacy model, and include a failing test before changing behavior. Run `npm run verify` before submitting changes.

## License

[MIT](LICENSE)
