import {
  type Categorisation,
  type CategoryGroup,
  type Prompt,
  type TabGroupColor,
  type TabInput,
} from "./domain";
import { ArkError } from "./errors";

function invalidResponse(
  context = "Categorisation response did not match the required schema",
): never {
  throw new ArkError("invalid_response", {
    stage: "validation",
    reason: "invalid_categorisation",
    context,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TAB_GROUP_COLORS: TabGroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

const COLOR_ALIASES = {
  gray: "grey",
  slate: "grey",
  silver: "grey",
  navy: "blue",
  maroon: "red",
  crimson: "red",
  gold: "yellow",
  lime: "green",
  olive: "green",
  magenta: "pink",
  fuchsia: "pink",
  violet: "purple",
  indigo: "purple",
  aqua: "cyan",
  teal: "cyan",
  turquoise: "cyan",
  amber: "orange",
  brown: "orange",
  coral: "orange",
} as const satisfies Record<string, TabGroupColor>;

const COLOR_RGB: Record<TabGroupColor, [number, number, number]> = {
  grey: [128, 128, 128],
  blue: [0, 0, 255],
  red: [255, 0, 0],
  yellow: [255, 255, 0],
  green: [0, 128, 0],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  cyan: [0, 255, 255],
  orange: [255, 165, 0],
};

function normaliseColor(value: unknown): TabGroupColor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalidResponse();

  const input = value.trim().toLowerCase();
  const supported = TAB_GROUP_COLORS.find((color) => color === input);
  if (supported) return supported;
  const alias = COLOR_ALIASES[input as keyof typeof COLOR_ALIASES];
  if (alias) return alias;

  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(input);
  if (!match) return undefined;
  const digits = match[1] ?? "";
  const hex =
    digits.length === 3
      ? [...digits].map((digit) => digit.repeat(2)).join("")
      : digits;
  const rgb = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  const distance = (color: TabGroupColor): number =>
    COLOR_RGB[color].reduce(
      (sum, channel, index) => sum + (channel - (rgb[index] ?? 0)) ** 2,
      0,
    );
  return TAB_GROUP_COLORS.reduce((closest, color) =>
    distance(color) < distance(closest) ? color : closest,
  );
}

export function parseCategorisation(
  text: string,
  expectedTabIds: string[],
): Categorisation {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidResponse("Categorisation response was not valid JSON");
  }

  if (
    !isRecord(value) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.ungroupedTabIds)
  )
    invalidResponse("Expected groups and ungroupedTabIds arrays");
  if (value.groups.length > 8)
    invalidResponse("Categorisation contained more than 8 groups");

  const expected = new Set(expectedTabIds);
  const seen = new Set<string>();
  const groups: CategoryGroup[] = value.groups.map((group): CategoryGroup => {
    if (!isRecord(group)) invalidResponse("A group was not an object");

    const name = typeof group.name === "string" ? group.name.trim() : "";
    if (!name || !Array.isArray(group.tabIds) || group.tabIds.length === 0) {
      invalidResponse("A group name or tab ID list was missing");
    }

    const tabIds = group.tabIds.map((id): string => {
      if (typeof id !== "string" || !expected.has(id) || seen.has(id)) {
        invalidResponse("A tab ID was unknown or repeated");
      }
      seen.add(id);
      return id;
    });

    const color = normaliseColor(group.color);
    return { name, ...(color ? { color } : {}), tabIds };
  });

  const ungroupedTabIds = value.ungroupedTabIds.map((id): string => {
    if (typeof id !== "string" || !expected.has(id) || seen.has(id)) {
      invalidResponse("A tab ID was unknown or repeated");
    }
    seen.add(id);
    return id;
  });

  if (seen.size !== expected.size)
    invalidResponse("One or more tab IDs were missing");
  return { groups, ungroupedTabIds };
}

export function defaultSystemPrompt(locale: string): string {
  return [
    "Categorise supplied browser tabs into up to 8 non-empty groups.",
    `Write short group names in locale ${locale}.`,
    "Prioritise each tab's title and URL path as signals of its subject. Treat the domain as secondary context, and do not group tabs merely because they share a domain.",
    "Put tabs without a useful shared category in ungroupedTabIds.",
    "Include every tab ID exactly once across groups and ungroupedTabIds.",
    "Each group may include an optional color: grey, blue, red, yellow, green, pink, purple, cyan, or orange.",
    "Return JSON only with this schema:",
    '{"groups":[{"name":"string","color":"grey","tabIds":["tab-id"]}],"ungroupedTabIds":["tab-id"]}',
  ].join(" ");
}

export function buildCategorisationPrompt(
  tabs: TabInput[],
  locale: string,
  systemPrompt = defaultSystemPrompt(locale),
): Prompt {
  const safeTabs = tabs.map(({ id, title, url }) => ({ id, title, url }));

  return {
    system: systemPrompt,
    user: JSON.stringify(safeTabs),
  };
}
