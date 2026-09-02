import { describe, expect, it } from "vitest";
import {
  buildCategorisationPrompt,
  parseCategorisation,
} from "../src/categorisation";
import type { TabInput } from "../src/domain";

const expectedIds = ["t0", "t1", "t2"];
const validResult = JSON.stringify({
  groups: [{ name: "Work", tabIds: ["t0", "t1"] }],
  ungroupedTabIds: ["t2"],
});

describe("parseCategorisation", () => {
  it("accepts every expected tab exactly once across groups and ungrouped tabs", () => {
    expect(parseCategorisation(validResult, expectedIds)).toEqual({
      groups: [{ name: "Work", tabIds: ["t0", "t1"] }],
      ungroupedTabIds: ["t2"],
    });
  });

  it("allows every tab to remain ungrouped", () => {
    const text = JSON.stringify({ groups: [], ungroupedTabIds: expectedIds });

    expect(parseCategorisation(text, expectedIds)).toEqual({
      groups: [],
      ungroupedTabIds: expectedIds,
    });
  });

  it("trims group names before returning them", () => {
    const text = JSON.stringify({
      groups: [
        { name: "  Work  ", tabIds: ["t0", "t1"] },
        { name: " Read ", tabIds: ["t2"] },
      ],
      ungroupedTabIds: [],
    });

    expect(
      parseCategorisation(text, expectedIds).groups.map(({ name }) => name),
    ).toEqual(["Work", "Read"]);
  });

  it.each([
    ["malformed JSON", "not json"],
    ["wrong root shape", JSON.stringify([])],
    [
      "blank name",
      JSON.stringify({
        groups: [
          { name: " ", tabIds: ["t0", "t1"] },
          { name: "Read", tabIds: ["t2"] },
        ],
        ungroupedTabIds: [],
      }),
    ],
    [
      "empty group",
      JSON.stringify({
        groups: [
          { name: "Work", tabIds: ["t0", "t1", "t2"] },
          { name: "Read", tabIds: [] },
        ],
        ungroupedTabIds: [],
      }),
    ],
    [
      "missing tab",
      JSON.stringify({
        groups: [
          { name: "Work", tabIds: ["t0"] },
          { name: "Read", tabIds: ["t1"] },
        ],
        ungroupedTabIds: [],
      }),
    ],
    [
      "duplicate tab",
      JSON.stringify({
        groups: [
          { name: "Work", tabIds: ["t0", "t1"] },
          { name: "Read", tabIds: ["t1", "t2"] },
        ],
        ungroupedTabIds: [],
      }),
    ],
    [
      "unknown tab",
      JSON.stringify({
        groups: [
          { name: "Work", tabIds: ["t0", "t1"] },
          { name: "Read", tabIds: ["t2", "t9"] },
        ],
        ungroupedTabIds: [],
      }),
    ],
    [
      "nine groups",
      JSON.stringify({
        groups: Array.from({ length: 9 }, (_, index) => ({
          name: `Group ${index}`,
          tabIds: [`t${index}`],
        })),
        ungroupedTabIds: [],
      }),
    ],
    [
      "tab duplicated as ungrouped",
      JSON.stringify({
        groups: [{ name: "Work", tabIds: ["t0", "t1"] }],
        ungroupedTabIds: ["t1", "t2"],
      }),
    ],
    [
      "missing ungrouped list",
      JSON.stringify({ groups: [{ name: "Work", tabIds: expectedIds }] }),
    ],
  ])("rejects %s", (_caseName, text) => {
    expect(() => parseCategorisation(text, expectedIds)).toThrowError(
      expect.objectContaining({ code: "invalid_response" }),
    );
  });
});

describe("buildCategorisationPrompt", () => {
  it("includes only model-safe tab fields and the requested locale", () => {
    const tabs: TabInput[] = [
      {
        id: "t0",
        chromeTabId: 987,
        title: "WXT documentation",
        url: "https://wxt.dev/guide",
      },
      {
        id: "t1",
        chromeTabId: 654,
        title: "Chrome extensions",
        url: "https://developer.chrome.com/docs/extensions",
      },
    ];

    const prompt = buildCategorisationPrompt(tabs, "zh-CN");

    expect(prompt.system).toContain("zh-CN");
    expect(prompt.system).toContain("8");
    expect(prompt.system).toContain("ungroupedTabIds");
    expect(prompt.system).toContain("without a useful shared category");
    expect(prompt.system).toContain("domain as secondary context");
    expect(prompt.user).toContain("WXT documentation");
    expect(prompt.user).toContain(
      "https://developer.chrome.com/docs/extensions",
    );
    expect(prompt.user).not.toContain("987");
    expect(prompt.user).not.toContain("654");
  });

  it("uses an edited system prompt without changing the tab payload", () => {
    const tabs: TabInput[] = [
      {
        id: "t0",
        chromeTabId: 987,
        title: "WXT documentation",
        url: "https://wxt.dev/guide",
      },
    ];

    expect(buildCategorisationPrompt(tabs, "en", "My complete prompt")).toEqual(
      {
        system: "My complete prompt",
        user: JSON.stringify([
          {
            id: "t0",
            title: "WXT documentation",
            url: "https://wxt.dev/guide",
          },
        ]),
      },
    );
  });
});
