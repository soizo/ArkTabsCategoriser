# UI Contract

Single source of truth for cross-screen visual consistency. Every value here
references a design token (CSS custom property / Tailwind theme key) — never a
raw hex or pixel literal. If a screen needs a value not listed, add the token
first, then cite it here.

## Tokens (authority)

Tokens live in the theme layer (e.g. `:root { --primary: ... }` /
`tailwind.config`). This file references them by name; it does not redefine them.

| Role | Token | Notes |
|---|---|---|
| canvas | `--ark-canvas` | Browser popup and options backdrop |
| surface | `--ark-surface` | Main utility sheet |
| raised | `--ark-surface-raised` | Inputs and elevated controls |
| foreground | `--ark-text` | Primary text |
| muted | `--ark-muted` | Secondary text |
| primary | `--ark-accent` | Brand and the single primary action |
| primary hover | `--ark-accent-hover` | Primary hover state |
| primary soft | `--ark-accent-soft` | Selected and quiet action surfaces |
| border | `--ark-border` | Hairlines and dividers |
| strong border | `--ark-border-strong` | Inputs and secondary controls |
| focus | `--ark-focus` | Keyboard focus ring |
| danger | `--ark-danger` | Error text |
| success | `--ark-success` | Success text |
| small radius | `--ark-radius-sm` | Inputs and buttons |
| medium radius | `--ark-radius-md` | Grouped regions |
| large radius | `--ark-radius-lg` | Settings sheet |
| elevation | `--ark-shadow` | Settings sheet and raised utility regions |

## Spacing scale

Use the existing compact rhythm in `entrypoints/popup/style.css` and the
roomier rhythm in `entrypoints/options/style.css`. Promote repeated values to
theme tokens before introducing a third rhythm.

## Type scale

Use the native UI stack declared in `src/ui/theme.css`. Keep the eligible-tab
count as the popup's only display-scale text; all controls remain UI-scale.

## Elevation

`--ark-shadow` is the only elevation tier. Use it on the settings sheet or one
structural popup surface, never on every control.

## Component invariants

One row per recurring surface (card, button, input, dialog). Record the exact
token recipe so every instance matches.

| Component | Recipe (tokens only) |
|---|---|
| sheet | bg `--ark-surface`, border `--ark-border`, radius `--ark-radius-lg`, shadow `--ark-shadow` |
| primary button | bg/border `--ark-accent`, white text, radius `--ark-radius-sm` |
| secondary button | bg `--ark-surface-raised`, border `--ark-border-strong`, text `--ark-text`, radius `--ark-radius-sm` |
| input/select | bg `--ark-surface-raised`, border `--ark-border-strong`, text `--ark-text`, radius `--ark-radius-sm` |
| status | muted `--ark-muted`; error `--ark-danger`; success `--ark-success` |
| reasoning region | bg `--ark-surface-raised`, border `--ark-border`; hidden when empty |

## Motion

Only state feedback may animate. All motion is suppressed by the existing
`prefers-reduced-motion` rule in `src/ui/theme.css`.

## Anti-slop guardrails

- No default-average look (generic Inter + purple gradient + centered hero).
- Real hierarchy: one focal point per screen.
- Intentional spacing: rhythm from the scale, not eyeballed gaps.
- Verify WCAG AA in the shipped light theme; no dark theme is currently
  promised by the product.
- Popup stays 360px wide with one visually dominant action.
- Model identity remains visible; testing it is secondary to organising.
- Provider reasoning is transient, selectable text and absent when empty.
