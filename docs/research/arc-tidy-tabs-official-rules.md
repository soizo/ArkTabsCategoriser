# Arc Tidy Tabs: official rules

Research date: 2026-09-02

## What Arc officially documents

Arc describes **Tidy Tabs** as an Arc Max feature that lets the Sidebar "organize itself." The documented operating rules are:

1. **Manual trigger:** the user presses the broom icon above Today Tabs.
2. **Minimum tab count:** the control is intended for situations with **more than six Today Tabs**.
3. **Scope:** it organises **Today Tabs only**—the unpinned tabs below the **+ New Tab** button.
4. **Isolation:** pinned tabs and other Sidebar tabs are not affected.
5. **Feature gate:** Tidy Tabs belongs to Arc Max, whose AI features can be enabled individually in Arc settings.
6. **AI processing:** Arc states that Max features require sending data to its AI partners.

Arc introduced Tidy Tabs in Arc for macOS 1.29.0 on 2024-02-08. The release note describes the same broom-button interaction and does not add semantic grouping rules.

## What Arc does not publicly specify

The official Help Center and release notes do **not** disclose:

- the prompt or model used;
- whether classification uses titles, URLs, page contents, or browsing history;
- a fixed category taxonomy;
- minimum or maximum category counts;
- category naming rules;
- treatment of singleton, ambiguous, or unrelated tabs;
- whether any tab may remain uncategorised;
- ordering rules within or between categories;
- confidence thresholds or retry behavior.

Therefore, there is no public "Arc categorisation algorithm" that Ark can reproduce exactly. Only the interaction boundary is documented: manually organise a sufficiently large set of unpinned/Today tabs without touching pinned content.

## Implication for Ark

Ark may accurately follow Arc's documented product principles—manual invocation, unpinned-tab scope, native grouping, and no disturbance to pinned tabs—but Ark's semantic categorisation rules must remain its own documented contract. Claims of exact Arc parity would not be supportable from first-party documentation.

## Primary sources

- Arc Help Center, **Arc Max: Boost Your Browsing with AI**: <https://resources.arc.net/hc/en-us/articles/19335160678679-Arc-Max-Boost-Your-Browsing-with-AI>
- Arc Help Center, **Arc for macOS – 2024–2026 Release Notes**, 2024-02-08, v1.29.0: <https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes>
- The Browser Company privacy policy, linked by the Arc Max documentation: <https://thebrowser.company/privacy/#what-personal-data-do-we-collect-and-how-do-we-collect-it>
