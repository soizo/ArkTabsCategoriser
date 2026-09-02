# Ark (Tabs Categoriser) Design

**Date:** 2026-09-02  
**Status:** Approved design, awaiting document review  
**License:** MIT

## 1. Product

Ark is an open-source Chrome extension that gives the current window's tabs Arc-inspired automatic organisation. The user supplies an LLM API key; Ark provides no model service, proxy, account, backend, telemetry, or cloud sync.

The first release has one primary action: the user opens Chrome's standard extension action popup and selects **Organise tabs**. Ark sends each non-pinned tab's title and full URL to the selected LLM, validates the result, and replaces the current window's native Chrome tab groups.

The interface and generated group names follow Chrome's locale. The initial locales are English and Simplified Chinese.

## 2. MVP scope

### Included

- Manual, on-demand categorisation of the current window.
- Chrome native tab groups.
- OpenAI, Anthropic, Google Gemini, and OpenRouter presets.
- A custom OpenAI-compatible endpoint.
- Online model-list loading and direct model-ID entry.
- Independent local settings for each provider and one active provider.
- Arc-inspired action popup and options page.
- English and Simplified Chinese localisation.
- MIT license, installation documentation, privacy disclosure, tests, and production build.

### Excluded

- Automatic or scheduled categorisation.
- Side panel, content scripts, webpage-body reading, and virtual tab groups.
- User-defined categories, categorisation history, undo history, or cross-device sync.
- Ark-hosted API proxy, accounts, analytics, or telemetry.
- Firefox, Safari, and other browser targets in the first release.
- Streaming output, chat history, and automatic API retries.

## 3. Technology

Use WXT with native TypeScript, HTML, and CSS. Do not add React, Vue, or a component library: the popup and options page do not require them.

WXT owns Manifest V3 generation, development loading, entry-point builds, and release packaging. Application code has three runtime entry points:

1. **Action popup** — shows status and starts categorisation.
2. **Options page** — manages provider credentials, model selection, and connection checks.
3. **Background service worker** — owns provider calls, result validation, and Chrome tab-group mutations.

No content script or Ark server is required.

## 4. Components

### 4.1 Action popup

The popup is Chrome's standard extension action popup. It displays:

- Ark identity and a settings button.
- Number of non-pinned tabs in the current window.
- Active provider and model.
- One **Organise tabs** button.
- Progress, success, configuration, and actionable error states.

If no provider is configured, the primary action opens the options page. If fewer than two eligible tabs exist, Ark explains that there is nothing to organise and does not call an API.

### 4.2 Options page

The options page provides tabs or segmented controls for OpenAI, Anthropic, Gemini, OpenRouter, and Custom.

Each provider stores its own API key and model ID. The Custom provider also stores a base URL. The currently selected provider becomes active when its valid settings are saved.

The model control is an editable combobox:

- It can load and filter models returned by the provider.
- It always permits direct entry of any model ID.
- Failure to load a model list does not prevent manual model entry or saving.
- Loading the model list also serves as the connection check; Ark does not make a paid categorisation request merely to test settings.

The API key field is masked. The page states that credentials are kept in `chrome.storage.local`, which is local extension storage rather than a separate encrypted vault.

### 4.3 Background service worker

The service worker is the single categorisation coordinator. It:

1. Reads eligible tabs from the current window.
2. Builds a provider-neutral categorisation request.
3. Calls the active provider adapter with a bounded timeout.
4. Validates the complete structured result locally.
5. Confirms that the eligible tab set has not changed while awaiting the model.
6. Rebuilds native Chrome tab groups.
7. Returns a small status result to the popup.

### 4.4 Provider adapters

Each adapter implements only:

- `listModels(settings, signal)`
- `categorise(settings, tabs, locale, signal)`

Protocol mapping:

| Provider | Model list | Categorisation |
| --- | --- | --- |
| OpenAI | OpenAI models API | Chat Completions with structured JSON instruction |
| Anthropic | Anthropic models API | Messages API |
| Gemini | Gemini models API | `generateContent` API |
| OpenRouter | OpenRouter models API | OpenAI-compatible Chat Completions |
| Custom | OpenAI-compatible `/models` when available | OpenAI-compatible Chat Completions |

The Custom base URL is normalised by removing trailing slashes before endpoint paths are appended. Model-list failure remains non-blocking.

Provider-specific request headers stay inside adapters. Secrets must never be written to logs or error messages.

## 5. Categorisation contract

Ark assigns each eligible tab a temporary request identifier and sends that identifier, title, and full URL. Chrome tab IDs are not treated as model output without validation.

The model is instructed to:

- Use the browser locale for group names.
- Create meaningful short names.
- Assign every supplied tab exactly once across generated groups and `ungroupedTabIds`.
- Put tabs without a useful shared category in `ungroupedTabIds`.
- Return between 0 and 8 non-empty groups, bounded by the number of tabs.
- Return JSON only in the requested schema.

The local validator rejects results containing:

- Invalid JSON or an unexpected shape.
- Missing, duplicated, or unknown tab identifiers.
- Empty groups or names.
- More than eight groups.
- A group count greater than the number of eligible tabs.

Ark does not silently repair ambiguous model output because doing so could misplace tabs. It reports the failure and allows the user to run the action again.

## 6. Applying Chrome tab groups

Eligible tabs are all non-pinned tabs in the current window, including tabs already grouped. Pinned tabs remain unchanged.

Ark must not mutate groups until the provider response passes validation. Immediately before mutation, it re-reads the current window; if eligible tabs were opened, closed, or replaced during the request, it aborts and asks the user to run again.

On success, Ark replaces existing grouping for eligible tabs with the generated groups and actively removes tabs listed in `ungroupedTabIds` from any previous group. It uses the generated names and assigns colours deterministically from Chrome's supported group colours. Colour selection does not require another model request.

Before mutation, Ark snapshots existing eligible-tab group membership and group metadata. If a Chrome grouping operation fails after mutation begins, Ark attempts a best-effort restoration and reports the failure. This restoration is for mutation safety, not a user-facing history or undo feature.

## 7. Storage, permissions, and privacy

Settings use `chrome.storage.local`; they are not stored in sync storage. Ark sends tab titles and full URLs directly from the extension to the active provider selected by the user.

Required extension permissions are limited to:

- `storage`
- `tabs`
- `tabGroups`

Provider origins are optional host permissions requested when that provider is configured, rather than broad site access requested at installation. A custom endpoint requests only its parsed origin. Custom endpoints require HTTPS, except loopback HTTP origins such as `localhost` and `127.0.0.1` for local development or local models.

The extension includes no content scripts, remote executable code, analytics, or third-party telemetry. Documentation and the options page disclose exactly what tab data is sent and where API keys are stored.

## 8. Error handling

The UI distinguishes at least:

- Provider not configured.
- Host permission denied.
- Invalid API key or unauthorised request.
- Rate limit or quota exceeded.
- Timeout or network failure.
- Model-list loading failure.
- Invalid categorisation response.
- Tabs changed while categorisation was running.
- Chrome tab-group mutation failure.

Provider, timeout, permission, and validation failures occur before tab mutation and leave existing groups unchanged. Ark does not automatically retry paid requests. Raw provider responses and API keys are not exposed in user-facing messages.

## 9. Visual direction

The interface is inspired by Arc's restrained, translucent visual language without copying Arc trademarks, proprietary assets, or exact layouts.

- Soft cool-grey and muted violet surfaces.
- Compact typography and generous internal spacing.
- One dominant action per screen.
- Subtle borders and shadows rather than decorative gradients or motion.
- Clear keyboard focus, sufficient contrast, reduced-motion compliance, and usable controls at Chrome popup dimensions.

The popup remains task-focused; infrequent configuration stays in the full options page.

## 10. Verification

Automated checks cover:

- Provider request mapping and response parsing with mocked fetch responses.
- Categorisation validation: grouped and ungrouped results, malformed JSON, omissions, duplicates, unknown IDs, empty groups, and excessive groups.
- Provider settings storage and direct model-ID entry.
- Base URL normalisation and endpoint construction.
- Type checking and production build.

Chrome manual acceptance covers:

1. Load the production build as an unpacked extension.
2. Configure each preset provider and the custom provider.
3. Load model lists, filter them, and save a manually entered model ID.
4. Organise a window containing grouped, ungrouped, and pinned tabs.
5. Confirm that grouped tabs are regrouped, model-selected tabs remain ungrouped, and pinned tabs remain unchanged.
6. Exercise unauthorised, rate-limited, timeout, malformed-response, and tabs-changed errors.
7. Confirm pre-mutation failures preserve existing groups.
8. Verify English and Simplified Chinese UI and generated-name instructions.
9. Check keyboard operation, focus visibility, popup overflow, and readable contrast.
10. Produce a release build suitable for Chrome's unpacked installation and store packaging.

No automated test uses a real user credential or makes a paid provider request.

## 11. Repository deliverables

- WXT project and source code.
- English and Simplified Chinese locale files.
- Extension icons and manifest metadata.
- Focused automated tests.
- `README.md` with purpose, local development, unpacked installation, provider setup, privacy behaviour, and release build instructions.
- `LICENSE` containing the MIT license.

The design intentionally stops at a complete Chrome MVP. Additional browsers, scheduled organisation, custom category rules, and history should only be added after demonstrated user need.
