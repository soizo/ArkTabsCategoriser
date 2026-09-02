# Ark Design System

Ark uses a restrained Chrome utility language inspired by Arc's calm density without copying Arc layouts, trademarks, or assets. The organising task stays visually dominant; decorative glass, gradients, and motion do not compete with it.

## Colour

Defined in `src/ui/theme.css`:

- Canvas: `#e9e5ed`
- Primary surface: `#f7f4f8`
- Raised controls: `#ffffff`
- Main text: `#28232d`
- Secondary text: `#655c6c`
- Accent/action: `#5d4d69`; hover `#4e4059`
- Hairlines: `#d4ccd8`; strong input border `#b7acbd`
- Focus: `#765889` mixed toward white for the 3px ring
- Error: `#9b3340`; success: `#356b50`

## Typography

Use the native UI stack: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`. This is an operational browser surface, not a marketing page. The popup's eligible-tab count is the only display-scale element and uses tabular numerals.

## Shape and depth

- Small radius: 9px
- Medium radius: 13px
- Large sheet radius: 18px
- Borders: 1px
- Depth: soft downward shadows with restrained opacity

Do not introduce nested cards, colored side stripes, gradient text, ornamental blur, emoji controls, or hard offset shadows.

## Popup

The popup is 360px wide. Reading order is fixed:

1. Ark identity and settings control
2. Eligible-tab count
3. Native selector for configured provider/model combinations plus a secondary
   connectivity test
4. One full-width organising action
5. Conditional transient OpenRouter reasoning
6. Status or recovery guidance
7. Data-sharing disclosure

The count is the focal point. The primary button must remain reachable and visually singular. Reserve status height to avoid layout jumps between idle, working, success, and error states.

The model controls share one quiet inset region. The reasoning region appears
only after displayable reasoning arrives, scrolls internally, and disappears
when the operation settles. It is working feedback rather than saved content.

## Options page

Use one centred settings sheet rather than a dashboard. Provider selection, API key, optional custom base URL, editable model combobox with load and test actions, editable system prompt with a restore-default action, privacy note, status, and save action form one continuous task.

At narrow widths, the model input, both model actions, and footer stack. All inputs, buttons, and provider options have a minimum 44px target. The page remains usable from 320px and at 200% zoom.

## States and accessibility

- Keyboard focus uses a visible 3px ring with 2px offset.
- Inputs use an accent-coloured caret and themed selection.
- Disabled actions remain legible and communicate waiting rather than disappearing.
- Errors explain the problem and recovery without exposing provider bodies or keys.
- English and Simplified Chinese use identical message identifiers and layout hierarchy.
- Motion is optional, minimal, and removed under `prefers-reduced-motion`.
