export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "custom";

export type TabInput = {
  id: string;
  chromeTabId: number;
  title: string;
  url: string;
};

export type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export type CategoryGroup = {
  name: string;
  color?: TabGroupColor;
  tabIds: string[];
};

export type Categorisation = {
  groups: CategoryGroup[];
  ungroupedTabIds: string[];
};

export type Prompt = {
  system: string;
  user: string;
};
