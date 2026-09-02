# Ark (Tabs Categoriser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete MIT-licensed Chrome Manifest V3 extension that uses a user-selected LLM to replace the current window's non-pinned tabs with validated native Chrome tab groups.

**Architecture:** WXT supplies the extension build and three entry points: popup, options, and background. Pure TypeScript modules own settings, provider protocols, categorisation validation, and reversible tab grouping; entry points only bind those modules to Chrome APIs and DOM events.

**Tech Stack:** Node.js 22+, npm, WXT 0.21.4, TypeScript 6.0.3, Vitest 4.1.11, native HTML/CSS, Chrome Manifest V3 APIs.

**Spec:** `docs/superpowers/specs/2026-09-02-ark-tabs-categoriser-design.md`

## Global Constraints

- Read `PRODUCT.md`, the spec, and `.impeccable/surfaces/entrypoints-popup-index-html.md` before implementation.
- Use WXT with native TypeScript, HTML, and CSS; do not add React, Vue, a component library, a backend, analytics, or telemetry.
- Required permissions are `storage`, `tabs`, and `tabGroups`; provider host access remains optional and is requested only from a user gesture.
- Send only each eligible tab's temporary ID, title, and full URL directly to the active provider.
- Pinned tabs remain untouched; all non-pinned tabs in the current window are eligible, including already grouped tabs.
- Validate the entire model result and re-check the tab set before mutating groups.
- Do not automatically retry paid requests or log API keys and raw provider bodies.
- Support English and Simplified Chinese using Chrome locale files.
- The UI is code-led and must follow the recorded direction contract: restrained Arc-inspired utility sheet, no decorative motion or ornamental glass effects.
- Do not initialise Git or create local commits unless the user explicitly authorises it. Each proposed commit step below is conditional on that authorisation.

## Planned File Map

```text
.gitignore                           Build, dependency, review, and secret exclusions
package.json                         WXT, TypeScript, Vitest commands
package-lock.json                    Reproducible dependency graph
tsconfig.json                        WXT TypeScript configuration
wxt.config.ts                        Manifest, permissions, locale, icons
vitest.config.ts                     Node test environment and test paths
assets/icon-source.svg               Original Ark icon artwork
public/icon/{16,32,48,128}.png       Generated Chrome icons
public/_locales/en/messages.json     English Chrome messages
public/_locales/zh_CN/messages.json  Simplified Chinese Chrome messages
src/errors.ts                        Stable internal error codes
src/domain.ts                        Shared provider, tab, and group types
src/categorisation.ts                Prompt creation and strict result validation
src/settings.ts                      Local provider settings persistence
src/permissions.ts                   Provider-origin parsing and runtime permission requests
src/providers/types.ts               Provider and fetch contracts
src/providers/openai-compatible.ts   OpenAI, OpenRouter, and Custom protocols
src/providers/anthropic.ts           Anthropic protocol
src/providers/gemini.ts              Gemini protocol
src/providers/index.ts               Provider selection
src/grouping.ts                      Snapshot, apply, and restoration logic
src/organise.ts                      End-to-end categorisation coordinator
src/messages.ts                      Typed popup/background messages
src/i18n.ts                          Chrome message helper and locale extraction
src/ui/theme.css                     Shared visual tokens and focus treatment
entrypoints/background.ts            Chrome API and message bindings
entrypoints/options/index.html       Provider settings markup
entrypoints/options/main.ts          Settings and editable model combobox behavior
entrypoints/options/style.css        Options layout
entrypoints/popup/index.html         Action popup markup
entrypoints/popup/main.ts            Popup state and organise action
entrypoints/popup/style.css          Popup layout
scripts/generate-icons.sh            Rebuild raster icons with ImageMagick
tests/*.test.ts                      Pure and mocked-boundary tests
README.md                            Development, installation, privacy, providers
LICENSE                              MIT license
DESIGN.md                            Visual system documented from the finished UI
```

---

### Task 1: Create a loadable, localised WXT shell

**Files:**

- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.ts`
- Create: `entrypoints/popup/style.css`
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/main.ts`
- Create: `entrypoints/options/style.css`
- Create: `public/_locales/en/messages.json`
- Create: `public/_locales/zh_CN/messages.json`
- Create: `assets/icon-source.svg`
- Create: `scripts/generate-icons.sh`
- Generate: `public/icon/16.png`
- Generate: `public/icon/32.png`
- Generate: `public/icon/48.png`
- Generate: `public/icon/128.png`

**Interfaces:**

- Produces: runnable `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`, and `npm run verify` commands.
- Produces: WXT popup, options, and background entry points consumed by later tasks.

- [ ] **Step 1: Create the package and compiler configuration**

```json
{
  "name": "ark-tabs-categoriser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "prepare": "wxt prepare",
    "typecheck": "wxt prepare && tsc --noEmit",
    "test": "vitest run",
    "verify": "npm run typecheck && npm test && npm run build"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "4.1.11",
    "wxt": "0.21.4"
  }
}
```

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

Create `.gitignore` with:

```gitignore
node_modules/
.output/
.wxt/
.superpowers/
.impeccable/build/
.impeccable/mocks/
.impeccable/review/
.env*
```

- [ ] **Step 2: Configure the Manifest V3 surface and least-privilege permissions**

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    permissions: ['storage', 'tabs', 'tabGroups'],
    optional_host_permissions: [
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
```

- [ ] **Step 3: Add minimal entry points that prove WXT discovers all three surfaces**

```ts
// entrypoints/background.ts
export default defineBackground(() => {});
```

```html
<!-- entrypoints/popup/index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ark</title></head>
  <body><main id="app">Ark</main><script type="module" src="./main.ts"></script></body>
</html>
```

```html
<!-- entrypoints/options/index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ark settings</title></head>
  <body><main id="app">Ark settings</main><script type="module" src="./main.ts"></script></body>
</html>
```

Both `main.ts` files import their sibling stylesheet and contain no behavior yet.

- [ ] **Step 4: Add locale files with real first-screen strings**

English keys: `extensionName`, `extensionDescription`, `organiseTabs`, `settings`, `eligibleTabCount`, `providerNotConfigured`. Chinese keys use the same identifiers and translate them as `Ark（标签页分类器）`, `使用自带的大语言模型 API 自动整理 Chrome 标签页`, `整理标签页`, `设置`, `$1 个可整理标签页`, and `请先配置模型`.

- [ ] **Step 5: Generate an original icon without adding a graphics dependency**

Create an original `assets/icon-source.svg`; do not copy Arc's logo:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#5d4d69"/>
  <path d="M35 88 59 34c2-5 8-5 10 0l24 54" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M45 69h39" fill="none" stroke="#d9cdea" stroke-width="9" stroke-linecap="round"/>
</svg>
```

Create `scripts/generate-icons.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p public/icon
for size in 16 32 48 128; do
  magick -background none assets/icon-source.svg -resize "${size}x${size}" "public/icon/${size}.png"
done
```

Run: `chmod +x scripts/generate-icons.sh && ./scripts/generate-icons.sh`

Expected: four PNG files with the requested dimensions.

- [ ] **Step 6: Install and verify the empty shell**

Run: `npm install && npm run typecheck && npm test && npm run build`

Expected: dependency installation succeeds, Vitest exits with no failing tests, and WXT creates `.output/chrome-mv3/` containing popup, options, background, locales, and icons.

- [ ] **Step 7: Conditionally commit the shell**

Only if the user has explicitly authorised local commits:

```bash
git add .gitignore package.json package-lock.json tsconfig.json wxt.config.ts vitest.config.ts assets public scripts entrypoints
 git commit -m "chore: initialise Ark extension"
```

---

### Task 2: Define and validate the categorisation contract

**Files:**

- Create: `src/errors.ts`
- Create: `src/domain.ts`
- Create: `src/categorisation.ts`
- Create: `tests/categorisation.test.ts`

**Interfaces:**

- Produces: `ArkError`, `ProviderId`, `TabInput`, `CategoryGroup`, `Categorisation`.
- Produces: `buildCategorisationPrompt(tabs, locale): Prompt`.
- Produces: `parseCategorisation(text, expectedTabIds): Categorisation`.

- [ ] **Step 1: Write failing validator tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCategorisation } from '../src/categorisation';

const ids = ['t0', 't1', 't2'];

describe('parseCategorisation', () => {
  it('accepts every expected tab exactly once', () => {
    expect(parseCategorisation('{"groups":[{"name":"Work","tabIds":["t0","t1"]},{"name":"Read","tabIds":["t2"]}]}', ids)).toEqual({
      groups: [
        { name: 'Work', tabIds: ['t0', 't1'] },
        { name: 'Read', tabIds: ['t2'] },
      ],
    });
  });

  it.each([
    ['not json', 'invalid_response'],
    ['{"groups":[{"name":"Work","tabIds":["t0","t1"]}]}', 'invalid_response'],
    ['{"groups":[{"name":"Work","tabIds":["t0","t1"]},{"name":"Read","tabIds":["t1","t2"]}]}', 'invalid_response'],
    ['{"groups":[{"name":"Work","tabIds":["t0","t1"]},{"name":"Read","tabIds":["t2","t9"]}]}', 'invalid_response'],
  ])('rejects invalid result %s', (text, code) => {
    expect(() => parseCategorisation(text, ids)).toThrowError(expect.objectContaining({ code }));
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/categorisation.test.ts`

Expected: FAIL because `src/categorisation.ts` does not exist.

- [ ] **Step 3: Add exact domain and error types**

```ts
// src/errors.ts
export type ArkErrorCode =
  | 'not_configured' | 'permission_denied' | 'unauthorised' | 'rate_limited'
  | 'timeout' | 'network' | 'invalid_response' | 'tabs_changed' | 'grouping_failed';

export class ArkError extends Error {
  constructor(public readonly code: ArkErrorCode, message = code) {
    super(message);
    this.name = 'ArkError';
  }
}
```

```ts
// src/domain.ts
export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom';
export type TabInput = { id: string; chromeTabId: number; title: string; url: string };
export type CategoryGroup = { name: string; tabIds: string[] };
export type Categorisation = { groups: CategoryGroup[] };
export type Prompt = { system: string; user: string };
```

- [ ] **Step 4: Implement strict parsing and prompt creation**

`parseCategorisation` must `JSON.parse`, require a plain `{groups}` object, require 2–8 groups, trim non-empty names, require non-empty string arrays, and compare a flattened ID list against the expected IDs with exact one-to-one membership. Any failure throws `new ArkError('invalid_response')`.

`buildCategorisationPrompt` must include the locale, 2–8 group rule bounded by tab count, exact schema, and `JSON.stringify(tabs.map(({id,title,url}) => ({id,title,url})))`. It must not include `chromeTabId`.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- tests/categorisation.test.ts && npm test`

Expected: PASS, including explicit tests for malformed shape, blank name, empty group, one group, nine groups, missing ID, duplicate ID, and unknown ID.

- [ ] **Step 6: Conditionally commit**

```bash
git add src/errors.ts src/domain.ts src/categorisation.ts tests/categorisation.test.ts
 git commit -m "feat: validate categorisation results"
```

Run only with explicit commit authorisation.

---

### Task 3: Persist provider settings and request only the selected origin

**Files:**

- Create: `src/settings.ts`
- Create: `src/permissions.ts`
- Create: `tests/settings.test.ts`
- Create: `tests/permissions.test.ts`

**Interfaces:**

- Produces: `ProviderSettings`, `ArkSettings`, `StorageArea`.
- Produces: `loadSettings(storage)`, `saveProvider(storage, provider, settings)`.
- Produces: `providerOrigin(provider, settings)`, `requestProviderPermission(permissions, provider, settings)`, and `hasProviderPermission(permissions, provider, settings)`.

- [ ] **Step 1: Write failing settings and origin tests**

Test that each provider retains independent credentials, saving one provider marks it active without deleting another, and missing storage returns `{providers:{}}`. Test fixed origins and these Custom cases:

```ts
expect(providerOrigin('custom', { apiKey: 'k', model: 'm', baseUrl: 'https://llm.example/v1/' })).toBe('https://llm.example');
expect(providerOrigin('custom', { apiKey: 'k', model: 'm', baseUrl: 'http://localhost:11434/v1' })).toBe('http://localhost:11434');
expect(() => providerOrigin('custom', { apiKey: 'k', model: 'm', baseUrl: 'http://llm.example/v1' })).toThrow();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/settings.test.ts tests/permissions.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement one local settings record**

```ts
export type ProviderSettings = { apiKey: string; model: string; baseUrl?: string };
export type ArkSettings = {
  activeProvider?: ProviderId;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
};
export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

const STORAGE_KEY = 'arkSettings';
```

`loadSettings` returns a new object and never exposes missing/invalid storage as an exception. `saveProvider` trims fields, requires API key and model, requires base URL only for Custom, merges the provider record, sets `activeProvider`, and writes only `{arkSettings: next}`.

- [ ] **Step 4: Implement origin validation and permission requesting**

Fixed origins are:

```ts
const FIXED_ORIGINS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
} as const;
```

Custom allows HTTPS or loopback HTTP only. Define `PermissionsPort` with `request({origins}): Promise<boolean>` and `contains({origins}): Promise<boolean>`. `requestProviderPermission` calls `request` and throws `ArkError('permission_denied')` when false; it is used only directly from Options-page button or submit gestures. `hasProviderPermission` calls `contains` so background categorisation never tries to open a permission prompt without a direct user gesture.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/settings.test.ts tests/permissions.test.ts`

Expected: PASS, including denied permission and malformed URL cases.

- [ ] **Step 6: Conditionally commit**

```bash
git add src/settings.ts src/permissions.ts tests/settings.test.ts tests/permissions.test.ts
 git commit -m "feat: store provider settings securely"
```

---

### Task 4: Implement all provider protocols behind two methods

**Files:**

- Create: `src/providers/types.ts`
- Create: `src/providers/openai-compatible.ts`
- Create: `src/providers/anthropic.ts`
- Create: `src/providers/gemini.ts`
- Create: `src/providers/index.ts`
- Create: `tests/providers.test.ts`

**Interfaces:**

- Consumes: `ProviderSettings`, `TabInput`, `Prompt`, `Categorisation`, `parseCategorisation`.
- Produces: `Provider` with `listModels(settings, signal)` and `categorise(settings, tabs, locale, signal)`.
- Produces: `getProvider(providerId, fetchImpl): Provider`.

- [ ] **Step 1: Write mocked-fetch tests before protocol code**

For each provider, assert request URL, auth header, model parsing, categorisation body, and response text extraction. Include status mapping: 401/403 → `unauthorised`, 429 → `rate_limited`, aborted request → `timeout`, other fetch rejection → `network`.

Representative OpenRouter assertion:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  'https://openrouter.ai/api/v1/chat/completions',
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ Authorization: 'Bearer key' }),
  }),
);
```

Representative Gemini model response: `{models:[{name:'models/gemini-2.5-flash'}]}` must produce `['gemini-2.5-flash']`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/providers.test.ts`

Expected: FAIL because provider modules are missing.

- [ ] **Step 3: Define the minimal provider boundary**

```ts
// src/providers/types.ts
export type Fetch = typeof fetch;
export type Provider = {
  listModels(settings: ProviderSettings, signal: AbortSignal): Promise<string[]>;
  categorise(settings: ProviderSettings, tabs: TabInput[], locale: string, signal: AbortSignal): Promise<Categorisation>;
};
```

Add shared helpers in this file: `requestJson(fetchImpl, url, init, signal)` and `mapHttpError(response)`. Return sorted unique model IDs.

- [ ] **Step 4: Implement OpenAI-compatible transport once**

`createOpenAICompatibleProvider` accepts `{baseUrl, modelsPath, chatPath, extraHeaders?, structuredOutput}`. Use it for:

- OpenAI: base `https://api.openai.com`, paths `/v1/models`, `/v1/chat/completions`, structured output enabled.
- OpenRouter: base `https://openrouter.ai`, paths `/api/v1/models`, `/api/v1/chat/completions`, header `X-Title: Ark (Tabs Categoriser)`, structured output disabled for compatibility across routed models.
- Custom: user base URL, paths `/models`, `/chat/completions`, structured output disabled for compatibility.

The completion body uses `model`, system/user messages from `buildCategorisationPrompt`, and `temperature: 0`. Parse `choices[0].message.content` with `parseCategorisation`.

- [ ] **Step 5: Implement Anthropic and Gemini adapters**

Anthropic uses `/v1/models` and `/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `max_tokens: 2048`, and parses the first text content block.

Gemini uses `/v1beta/models` and `/v1beta/models/{encodedModel}:generateContent`, sends `x-goog-api-key`, uses `systemInstruction`, requests `responseMimeType: 'application/json'`, and concatenates candidate text parts.

- [ ] **Step 6: Create provider selection without classes or factories per vendor**

```ts
export function getProvider(id: ProviderId, fetchImpl: Fetch = fetch): Provider {
  if (id === 'anthropic') return createAnthropicProvider(fetchImpl);
  if (id === 'gemini') return createGeminiProvider(fetchImpl);
  return createOpenAICompatibleProvider(id, fetchImpl);
}
```

Keep endpoint selection inside the compatible adapter; do not create empty wrapper classes for OpenAI and OpenRouter.

- [ ] **Step 7: Run provider and full tests**

Run: `npm test -- tests/providers.test.ts && npm test`

Expected: PASS with no live HTTP requests.

- [ ] **Step 8: Conditionally commit**

```bash
git add src/providers tests/providers.test.ts
 git commit -m "feat: support user-selected LLM providers"
```

---

### Task 5: Apply categorisation transactionally to native Chrome groups

**Files:**

- Create: `src/grouping.ts`
- Create: `tests/grouping.test.ts`

**Interfaces:**

- Consumes: validated `Categorisation` and initial `TabInput[]`.
- Produces: `TabsPort` and `applyCategorisation(port, initialTabs, result): Promise<void>`.

- [ ] **Step 1: Write failing transaction tests**

Use a memory `TabsPort` fake. Cover:

1. Groups every non-pinned tab according to the result and updates title/colour.
2. Aborts with `tabs_changed` before any mutation when current tab IDs or URLs differ.
3. Leaves pinned tabs outside all calls.
4. Snapshots existing group names, colours, collapsed state, and memberships.
5. On a failure during the second generated group, ungroups eligible tabs and recreates the snapshot; finally throws `grouping_failed`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/grouping.test.ts`

Expected: FAIL because `src/grouping.ts` is missing.

- [ ] **Step 3: Define the Chrome boundary**

```ts
export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
export type BrowserTab = { id: number; windowId: number; title?: string; url?: string; pinned: boolean; groupId: number };
export type BrowserGroup = { id: number; title?: string; color: TabGroupColor; collapsed: boolean };
export type TabsPort = {
  queryCurrentWindow(): Promise<BrowserTab[]>;
  queryGroups(windowId: number): Promise<BrowserGroup[]>;
  group(tabIds: number[]): Promise<number>;
  ungroup(tabIds: number[]): Promise<void>;
  updateGroup(groupId: number, changes: {title?: string; color?: TabGroupColor; collapsed?: boolean}): Promise<void>;
};
```

- [ ] **Step 4: Implement preflight, snapshot, apply, and restore**

Compare sorted `{chromeTabId,url}` pairs from `initialTabs` against the latest non-pinned tabs before mutation. Snapshot `groupId === -1` as ungrouped and query metadata only for used group IDs.

Use the deterministic colour order:

```ts
const COLORS: TabGroupColor[] = [
  'purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'grey',
];
```

For each category, map temporary IDs to Chrome IDs, call `group`, then `updateGroup`. On failure, attempt restoration in a nested `try`, ignore only restoration's own error, and throw `ArkError('grouping_failed')`.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/grouping.test.ts`

Expected: PASS with assertions that no mutating method runs before preflight succeeds.

- [ ] **Step 6: Conditionally commit**

```bash
git add src/grouping.ts tests/grouping.test.ts
 git commit -m "feat: apply native tab groups safely"
```

---

### Task 6: Orchestrate the workflow in the background service worker

**Files:**

- Create: `src/organise.ts`
- Create: `src/messages.ts`
- Modify: `entrypoints/background.ts`
- Create: `tests/organise.test.ts`

**Interfaces:**

- Consumes: settings, permissions, provider selection, grouping.
- Produces: `organiseTabs(deps): Promise<{groupCount:number}>`.
- Produces message types `popupState`, `organise`, and `openOptions` with typed responses.

- [ ] **Step 1: Write coordinator tests with dependency fakes**

Test these exact paths:

- Missing active provider → `not_configured`; provider is not called.
- Fewer than two eligible tabs → `{groupCount:0}`; provider is not called.
- Normal run maps tabs to `t0`, `t1`, … and calls provider then grouping once.
- Timeout aborts at 30 seconds and maps to `timeout`.
- Provider/validation errors never call grouping.
- Unknown errors become `network` before grouping and `grouping_failed` after grouping starts.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/organise.test.ts`

Expected: FAIL because `organiseTabs` is missing.

- [ ] **Step 3: Implement a dependency-injected coordinator**

```ts
export type OrganiseDeps = {
  storage: StorageArea;
  permissions: PermissionsPort;
  tabs: TabsPort;
  providerFor(id: ProviderId): Provider;
  locale: string;
  timeoutMs?: number;
};
```

`organiseTabs` loads settings, checks the active provider, verifies its previously granted origin with `hasProviderPermission`, reads current non-pinned tabs, maps them to temporary IDs, starts one `AbortController` timeout, calls `categorise`, clears the timer in `finally`, calls `applyCategorisation`, and returns the generated group count. Permission requesting remains in the Options-page user gestures from Task 7.

- [ ] **Step 4: Bind real Chrome APIs only in `entrypoints/background.ts`**

Create a `TabsPort` using `browser.tabs.query`, `browser.tabGroups.query`, `browser.tabs.group`, `browser.tabs.ungroup`, and `browser.tabGroups.update`. Register one `browser.runtime.onMessage` listener and switch on the typed message. Do not put provider protocol logic in the entry point.

`popupState` returns eligible count plus active provider/model. `openOptions` calls `browser.runtime.openOptionsPage()`. `organise` returns `{ok:true,groupCount}` or `{ok:false,errorCode}`; raw exception text is never sent.

- [ ] **Step 5: Run diagnostics and tests**

Run: `npm run typecheck && npm test -- tests/organise.test.ts && npm test`

Expected: PASS.

- [ ] **Step 6: Conditionally commit**

```bash
git add src/organise.ts src/messages.ts entrypoints/background.ts tests/organise.test.ts
 git commit -m "feat: orchestrate tab categorisation"
```

---

### Task 7: Build the provider options experience

**Files:**

- Create: `src/i18n.ts`
- Create: `src/ui/theme.css`
- Replace: `entrypoints/options/index.html`
- Replace: `entrypoints/options/main.ts`
- Replace: `entrypoints/options/style.css`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`

**Interfaces:**

- Consumes: `loadSettings`, `saveProvider`, `requestProviderPermission`, `getProvider`.
- Produces: a keyboard-usable provider selector, masked API key, custom base URL, editable model combobox, model loading, and save feedback.

- [ ] **Step 1: Build semantic markup before styling**

Use a `<form>`, radio-backed provider selector, labelled password input, conditional URL input, and native editable combobox:

```html
<label for="model">Model</label>
<div class="model-row">
  <input id="model" name="model" list="model-list" autocomplete="off" required>
  <button id="load-models" type="button">Load models</button>
</div>
<datalist id="model-list"></datalist>
```

Include `aria-live="polite"` status output and one submit button. The native `<datalist>` is the complete combobox solution; do not build a custom listbox.

- [ ] **Step 2: Implement exact state behavior**

On load, populate each provider's saved values without exposing one provider's key in another. Changing provider updates fields but does not save. Custom alone shows Base URL.

**Load models:** request the provider permission from that button click, call `listModels` with a 30-second abort, replace datalist options, preserve manually typed text, and show localised success/failure.

**Save:** validate fields, request permission from the submit gesture, persist settings, and show localised `Settings saved`. Model-list failure never disables submit.

- [ ] **Step 3: Implement the recorded visual direction**

Create shared tokens in `src/ui/theme.css`: cool-lilac surface, charcoal text, muted secondary text, deep-plum action, 1px hairline, 10–14px corner range, system UI font, visible 3px focus ring. Avoid gradients, backdrop-filter stacking, ornamental blur, and non-functional animation.

Options uses a quiet centred sheet with provider controls in one row on wide screens and wrapped controls on narrow screens. The form remains readable at 320px and supports 200% zoom.

- [ ] **Step 4: Complete both locale files**

Add every options label, helper, validation error, network error, and save status. Keep actions verb-first and use the same term consistently for Organise/整理.

- [ ] **Step 5: Verify the options page manually**

Run: `npm run dev`

Load `.output/chrome-mv3/` in Chrome. Verify keyboard-only provider changes, focus order, password masking, Custom URL visibility, online model loading, direct model text entry, permission denial, save persistence, English, and Simplified Chinese.

Expected: no horizontal overflow at 320px; model text remains editable after model-list loading.

- [ ] **Step 6: Run automated checks**

Run: `npm run typecheck && npm test && npm run build`

Expected: PASS.

- [ ] **Step 7: Conditionally commit**

```bash
git add src/i18n.ts src/ui/theme.css entrypoints/options public/_locales
 git commit -m "feat: add provider settings interface"
```

---

### Task 8: Build the one-action popup and end-to-end status states

**Files:**

- Replace: `entrypoints/popup/index.html`
- Replace: `entrypoints/popup/main.ts`
- Replace: `entrypoints/popup/style.css`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`

**Interfaces:**

- Consumes: typed runtime messages from Task 6 and shared theme/i18n helpers from Task 7.
- Produces: ready, unconfigured, organising, success, nothing-to-organise, and actionable error states.

- [ ] **Step 1: Create the exact popup hierarchy from the surface brief**

Use a 360px main surface with:

```html
<header><strong>Ark</strong><button id="settings" type="button" aria-label="Settings">…</button></header>
<section aria-labelledby="tab-count-label">
  <div id="tab-count">0</div>
  <p id="tab-count-label"></p>
</section>
<p id="active-model"></p>
<button id="organise" type="button"></button>
<p id="status" role="status" aria-live="polite"></p>
```

Use an inline icon no larger than 24px for settings; no icon library.

- [ ] **Step 2: Implement finite UI states without a framework**

Use a local union:

```ts
type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; provider: string; model: string }
  | { kind: 'unconfigured'; count: number }
  | { kind: 'working'; count: number; provider: string; model: string }
  | { kind: 'success'; count: number; groupCount: number }
  | { kind: 'error'; count: number; code: ArkErrorCode };
```

One `render(state)` function updates text, disabled state, and visibility. Settings sends `openOptions`. Organise sets `working`, sends `organise`, then renders success or the localised error. Disable the primary button while working to prevent duplicate paid requests.

- [ ] **Step 3: Style for operational clarity**

Keep the tab count as the largest element, provider/model as one quiet truncating line with a `title` attribute, and the full-width plum action at the bottom. Translucency is one structural surface treatment, not layered decoration. Motion is limited to a reduced-motion-safe opacity change on status; no spinner is required.

- [ ] **Step 4: Verify all popup states in Chrome**

Test unconfigured, 0/1 eligible tabs, ready, working, success, unauthorised, rate-limited, timeout, invalid response, tabs changed, permission denied, and grouping failure. Verify pinned tabs are excluded from count.

At 360px width and 200% zoom, confirm no clipped action or status. Verify keyboard operation and both locales.

- [ ] **Step 5: Run the complete automated suite and production build**

Run: `npm run verify`

Expected: typecheck, all Vitest tests, and WXT production build pass.

- [ ] **Step 6: Conditionally commit**

```bash
git add entrypoints/popup public/_locales
 git commit -m "feat: add one-click organisation popup"
```

---

### Task 9: Document, inspect, and package the complete extension

**Files:**

- Create: `LICENSE`
- Create: `README.md`
- Create: `DESIGN.md`
- Modify only if implementation evidence requires it: `.impeccable/surfaces/entrypoints-popup-index-html.md`
- Generate: `.output/ark-tabs-categoriser-*.zip`
- Generate review evidence under: `.impeccable/review/`

**Interfaces:**

- Consumes: the finished build and every prior verification command.
- Produces: open-source documentation, release archive, visual evidence, Impeccable finish verdict.

- [ ] **Step 1: Write the MIT license and honest README**

Use the standard MIT license text with copyright year 2026 and the repository owner's chosen copyright name; if no name has been supplied, use `Ark contributors` rather than inventing a person or organisation.

README sections: purpose, screenshots only if real captures exist, supported providers, privacy/data flow, API-key storage warning, prerequisites (Node 22+), `npm install`, `npm run dev`, unpacked Chrome installation, provider configuration, test/build/zip commands, permissions rationale, limitations, contributing, and MIT license.

Do not claim Chrome Web Store publication, users, benchmarks, or provider endorsement.

- [ ] **Step 2: Run one mechanical design-detector pass**

Run exactly once after both UI surfaces are complete:

```bash
node /Users/soizoktantas/.pi/agent/skills/impeccable/scripts/detect.mjs --json entrypoints/popup entrypoints/options src/ui/theme.css
```

Fix all mechanical accessibility, generic-design, overflow, and CSS findings in one batch. Do not run the detector a second time.

- [ ] **Step 3: Capture one batched visual inspection round**

Build and load the extension in Chrome. Capture the popup at its shipped width and the options page at 1440px and 390px into:

```text
.impeccable/review/popup.png
.impeccable/review/options-desktop.png
.impeccable/review/options-mobile.png
```

Open each image once and confirm it contains the named surface, starts at the top, has loaded text/styles, and is not blank or clipped. Batch-fix every material issue found; capture at most one confirmation round.

- [ ] **Step 4: Run the shipped Impeccable finish reviewer**

Invoke `impeccable-finish-reviewer` fresh with: original request, confirmed product answers, popup/options paths, all three screenshot paths, `.impeccable/surfaces/entrypoints-popup-index-html.md`, detector findings, the code-led direction seed `a182df31`, and `/Users/soizoktantas/.pi/agent/skills/impeccable/reference/craft-floor.md`.

Act on its exact disposition: `recapture`, `rebuild`, `fix`, or `ship`. For `fix`, apply one batch, recapture the same files, and return them to the same reviewer for a verdict. Stop after the bounded second round unless the user explicitly funds another.

- [ ] **Step 5: Document the visual system from shipped code**

Create `DESIGN.md` only after the reviewer disposition permits shipping. Record actual colours, typography, spacing, radii, focus treatment, popup composition, options composition, states, localisation behavior, and the ban on decorative effects. Do not describe intended values that are absent from the final CSS.

- [ ] **Step 6: Run final technical verification**

Run:

```bash
npm run verify
npm run zip
```

Expected: all checks pass and WXT creates a Chrome MV3 release archive. Inspect the archive listing and confirm it includes manifest, popup, options, background, `_locales`, and icons; confirm it excludes source tests, API keys, `.impeccable`, and mockup files.

- [ ] **Step 7: Complete manual acceptance from the spec**

With an unpacked production build, verify all five provider configurations, model-list loading, manual model IDs, grouped/ungrouped/pinned tabs, each documented error state, no pre-mutation damage, English and Chinese, keyboard focus, contrast, and popup overflow. Make live provider calls only with credentials the user explicitly supplies; otherwise rely on mocked protocol tests, mark those external smoke checks as not run, and record that limitation in the implementation handoff rather than inventing README claims.

- [ ] **Step 8: Run final diagnostics**

Run language diagnostics on all changed TypeScript files, then `lens_diagnostics mode=all`. Resolve every blocking error before claiming completion.

- [ ] **Step 9: Conditionally commit the release-ready project**

Only with explicit commit authorisation:

```bash
git add .gitignore LICENSE README.md DESIGN.md package.json package-lock.json tsconfig.json wxt.config.ts vitest.config.ts assets public scripts src entrypoints tests docs PRODUCT.md .impeccable/config.json .impeccable/surfaces
 git commit -m "feat: build Ark tabs categoriser"
```

Do not add `.impeccable/review/`, `.impeccable/build/`, `.superpowers/`, `.output/`, or credentials.
