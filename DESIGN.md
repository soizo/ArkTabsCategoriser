# Ark Design System

Ark uses a restrained browser utility language inspired by Arc's calm density without copying Arc layouts, trademarks, or assets. The organising task stays visually dominant; decorative glass, gradients, and motion do not compete with it.

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
4. One full-width organising action, followed by a secondary Stop button while active
5. Compact multi-select renaming for existing groups
6. Conditional transient output for OpenRouter reasoning or task diagnostics
7. Status or recovery guidance
8. Data-sharing disclosure

The count is the focal point. The primary button must remain reachable and visually singular. Reserve status height to avoid layout jumps between idle, working, success, and error states.

Existing groups can be renamed from one compact disclosure below the primary
action. Selected rows enable their own name fields, and the bounded list scrolls
rather than displacing the primary task.

The model controls share one quiet inset region, including model-test feedback
and its diagnostic output. Organisation output belongs below the task controls.
Stop stays visible but disabled during cancellation or the final tab-group commit;
nearby text explains why. Reopened popups show the running task's actual model,
original-window count, and original elapsed time rather than starting again.

The output region appears after displayable reasoning or an error and scrolls
internally. Recent reasoning is bounded in worker memory for reconnection and
never written to storage. Only a small task summary uses session storage. Successful runs clear it. Failed runs retain any reasoning already
shown and append safe diagnostics without request bodies, provider responses,
keys, tab data, or stack traces.

## Options page

Use one centred settings sheet rather than a dashboard. Provider selection, API key, optional custom base URL, editable model combobox with load and test actions, prompt settings, privacy note, status, safe diagnostic output, and save action form one continuous task. A collapsed advanced section optionally overrides the model input token limit; blank keeps automatic retry-and-split behavior.

Model loading and testing have their own live status directly below the model
buttons; related diagnostics appear there too. Save feedback stays at the footer.
A provider switch invalidates pending model feedback, and asynchronous requests
retain the provider/credentials captured when the action began.

Prompt settings use three vertically stacked native textareas: editable
Classification requirements with a restore-default action, optional Knowledge,
and a read-only Final System Prompt with a copy action. Restore preserves
Knowledge. The preview reflects unsaved edits and explains that runtime batches
append group context. Copy feedback is adjacent to the preview, separate from
save feedback; clipboard failures select the text and explain manual copying.
Keep persistent labels and help text, following [GOV.UK textarea guidance](https://design-system.service.gov.uk/components/textarea/), and give copy/save actions distinct feedback following [Nielsen's visibility-of-system-status heuristic](https://www.nngroup.com/articles/ten-usability-heuristics/).

At narrow widths, the model input, both model actions, and footer stack. All inputs, buttons, and provider options have a minimum 44px target. The page remains usable from 320px and at 200% zoom.

## States and accessibility

- Keyboard focus uses a visible 3px ring with 2px offset.
- Inputs use an accent-coloured caret and themed selection.
- Disabled actions remain legible and communicate waiting rather than disappearing.
- Errors explain the problem and recovery without exposing provider bodies or keys.
- English and Simplified Chinese use identical message identifiers and layout hierarchy.
- Motion is optional, minimal, and removed under `prefers-reduced-motion`.
