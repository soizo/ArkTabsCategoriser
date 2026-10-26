# Ark · Tabs Categoriser

<table>
  <tr>
    <td><img src="assets/icon-source.svg" alt="Ark icon" width="80" height="80"></td>
    <td>Organise your browser tabs into native groups with your own AI provider.</td>
  </tr>
</table>

Supports Chrome and desktop Firefox 140+, with OpenAI, Anthropic, Gemini, OpenRouter, or any OpenAI-compatible API.

[![Get Ark for Firefox](https://img.shields.io/badge/Get%20Ark%20for-Firefox-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/ark-tabs-categoriser/)

## Install

Requires Node.js 22+ and npm.

```bash
npm install
npm run build          # Chrome
npm run build:firefox  # Firefox
```

- **Chrome:** enable Developer mode at `chrome://extensions`, then load `.output/chrome-mv3/` as an unpacked extension.
- **Firefox:** at `about:debugging#/runtime/this-firefox`, load `.output/firefox-mv3/manifest.json` as a temporary add-on. It is removed when Firefox exits; permanent installation requires Mozilla signing.

## Usage

```text
Settings → choose provider → enter API key → choose model → Save
Open Ark from the toolbar → Organise tabs
```

Approve provider access when prompted. For custom APIs, include the version path in the base URL, such as `https://llm.example/v1`.

Edit **Classification requirements** for grouping rules and **Knowledge** for extra context. Ark replaces non-pinned tabs' group memberships in the current window; pinned tabs stay unchanged. You can also rename existing groups from the popup.

Closing the popup lets the task continue. **Stop** cancels further work but cannot undo API charges. There is no undo history or cross-device sync.

## Privacy

Tab titles, full URLs, grouping rules, and all Knowledge go directly to your chosen provider; page contents are never read. API keys and settings stay in local browser storage, not an encrypted vault. Ark has no backend or analytics. Provider charges apply, including tests and recovery requests.

## Development

```bash
npm run dev          # Chrome; use dev:firefox for Firefox
npm run verify       # Types, tests, and both browser builds
npm run zip          # Chrome ZIP; use zip:firefox for Firefox
```

See [release workflow](docs/github-releases.md) for publishing details.

## Contributing

Open an issue for questions or bugs, or submit a focused PR. Preserve direct-to-provider processing, add a failing test for behavior changes, and run `npm run verify`.

## License

[MIT](LICENSE) © 2026 Ark contributors.
