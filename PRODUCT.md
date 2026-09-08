# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

WXT with native TypeScript, HTML, and CSS for a Chrome and desktop Firefox 140+ Manifest V3 extension. No frontend component framework or Ark-hosted backend.

## Users

Ark primarily serves heavy tab users doing research, software development, or other knowledge work. They often have many open tabs and need to recover a useful structure without sorting each tab manually.

## Product Purpose

Ark organises the current browser window's non-pinned tabs into native tab groups while allowing the LLM to leave unsuitable tabs ungrouped. The user triggers one action, their selected LLM generates categories, and Ark applies only a locally validated result. Success means a cluttered working window becomes understandable without moving the user to another browser or requiring a new account.

## Positioning

Ark brings LLM-assisted, Arc-inspired tab categorisation to Chrome and Firefox while remaining provider-independent: users bring their own API access, requests go directly to that provider, and the resulting categories remain visible as browser-native tab groups.

## Operating Context

The user opens the browser's extension action popup while working in a tab-heavy window, reviews the active model, and selects **Organise tabs**. Provider credentials and models are configured separately in the extension options page. Existing non-pinned groups may be replaced; pinned tabs remain untouched.

## Capabilities and Constraints

- Manual categorisation only in the first release; no scheduled or continuous organisation.
- Supports OpenAI, Anthropic, Gemini, OpenRouter, and a custom OpenAI-compatible endpoint.
- Model lists can be loaded online, but model IDs always remain directly editable.
- Lets the model explicitly leave tabs without a useful shared category ungrouped.
- Sends eligible tab titles and full URLs to the user-selected provider.
- Stores provider settings in local extension storage; no account, cloud sync, telemetry, proxy, or Ark-hosted model service.
- Uses browser-native tab groups and the standard extension action popup; no side panel or content script.
- English and Simplified Chinese interfaces follow the browser's locale.
- Open source under the MIT license.

## Brand Commitments

The product name is **Ark (Tabs Categoriser)**. Its visual language is Arc-inspired: restrained, compact, translucent, and calm, without copying Arc trademarks, proprietary assets, or exact layouts. Decorative glass, gradients, or motion must never compete with the organising task.

## Evidence on Hand

No customer claims, usage metrics, testimonials, or production screenshots exist yet. Future work must not fabricate them.

## Product Principles

- One deliberate action should turn tab clutter into a usable structure.
- Failed or invalid model output must not damage the user's current organisation.
- Provider choice and data flow remain visible and controlled by the user.
- Prefer browser-native behavior over an Ark-specific replacement interface.
- Keep the extension focused: no account or backend unless proven necessary.

## Accessibility & Inclusion

The popup and options page must support keyboard operation, visible focus, readable contrast, reduced motion, and English and Simplified Chinese localisation.
