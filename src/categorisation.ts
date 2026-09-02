import type { Categorisation, CategoryGroup, Prompt, TabInput } from "./domain";
import { ArkError } from "./errors";

function invalidResponse(): never {
  throw new ArkError("invalid_response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCategorisation(
  text: string,
  expectedTabIds: string[],
): Categorisation {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidResponse();
  }

  if (
    !isRecord(value) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.ungroupedTabIds)
  )
    invalidResponse();
  if (value.groups.length > 8) invalidResponse();

  const expected = new Set(expectedTabIds);
  const seen = new Set<string>();
  const groups: CategoryGroup[] = value.groups.map((group): CategoryGroup => {
    if (!isRecord(group)) invalidResponse();

    const name = typeof group.name === "string" ? group.name.trim() : "";
    if (!name || !Array.isArray(group.tabIds) || group.tabIds.length === 0) {
      invalidResponse();
    }

    const tabIds = group.tabIds.map((id): string => {
      if (typeof id !== "string" || !expected.has(id) || seen.has(id)) {
        invalidResponse();
      }
      seen.add(id);
      return id;
    });

    return { name, tabIds };
  });

  const ungroupedTabIds = value.ungroupedTabIds.map((id): string => {
    if (typeof id !== "string" || !expected.has(id) || seen.has(id)) {
      invalidResponse();
    }
    seen.add(id);
    return id;
  });

  if (seen.size !== expected.size) invalidResponse();
  return { groups, ungroupedTabIds };
}

export function buildCategorisationPrompt(
  tabs: TabInput[],
  locale: string,
): Prompt {
  const safeTabs = tabs.map(({ id, title, url }) => ({ id, title, url }));

  return {
    system: [
      "Categorise supplied browser tabs into up to 8 non-empty groups.",
      `Write short group names in locale ${locale}.`,
      "Prioritise each tab's title and URL path as signals of its subject. Treat the domain as secondary context, and do not group tabs merely because they share a domain.",
      "Put tabs without a useful shared category in ungroupedTabIds.",
      "Include every tab ID exactly once across groups and ungroupedTabIds.",
      "Return JSON only with this schema:",
      '{"groups":[{"name":"string","tabIds":["tab-id"]}],"ungroupedTabIds":["tab-id"]}',
    ].join(" "),
    user: JSON.stringify(safeTabs),
  };
}
