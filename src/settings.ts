import type { ProviderId } from "./domain";

export type ProviderSettings = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  inputTokenLimit?: number;
};

export type ArkSettings = {
  activeProvider?: ProviderId;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
  classificationRequirements?: string;
  knowledge?: string;
};

export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

const STORAGE_KEY = "arkSettings";
const PROVIDERS: ProviderId[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "custom",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProviderSettings(value: unknown): ProviderSettings | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.apiKey !== "string" || typeof value.model !== "string") {
    return undefined;
  }
  if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") {
    return undefined;
  }
  const inputTokenLimit =
    Number.isInteger(value.inputTokenLimit) && Number(value.inputTokenLimit) > 0
      ? Number(value.inputTokenLimit)
      : undefined;
  return {
    apiKey: value.apiKey,
    model: value.model,
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl }),
    ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
  };
}

export async function loadSettings(storage: StorageArea): Promise<ArkSettings> {
  const stored = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
  if (!isRecord(stored) || !isRecord(stored.providers))
    return { providers: {} };

  const providers: ArkSettings["providers"] = {};
  for (const provider of PROVIDERS) {
    const settings = readProviderSettings(stored.providers[provider]);
    if (settings) providers[provider] = settings;
  }

  const activeProvider = PROVIDERS.find(
    (provider) => provider === stored.activeProvider && providers[provider],
  );
  // Read legacy prompts verbatim; the next explicit save writes the new shape.
  const classificationRequirements = [
    stored.classificationRequirements,
    stored.systemPrompt,
  ].find(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim()),
  );
  const knowledge =
    typeof stored.knowledge === "string" ? stored.knowledge : undefined;
  return {
    ...(activeProvider ? { activeProvider } : {}),
    providers,
    ...(classificationRequirements ? { classificationRequirements } : {}),
    ...(knowledge === undefined ? {} : { knowledge }),
  };
}

export async function saveProvider(
  storage: StorageArea,
  provider: ProviderId,
  settings: ProviderSettings,
  prompt?: { classificationRequirements: string; knowledge: string },
): Promise<ArkSettings> {
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();
  const baseUrl = settings.baseUrl?.trim();
  const inputTokenLimit = settings.inputTokenLimit;
  if (
    !apiKey ||
    !model ||
    (provider === "custom" && !baseUrl) ||
    (inputTokenLimit !== undefined &&
      (!Number.isInteger(inputTokenLimit) || inputTokenLimit <= 0)) ||
    (prompt !== undefined &&
      (typeof prompt.classificationRequirements !== "string" ||
        !prompt.classificationRequirements.trim() ||
        typeof prompt.knowledge !== "string"))
  ) {
    throw new TypeError("Incomplete provider settings");
  }

  const current = await loadSettings(storage);
  const classificationRequirements =
    prompt?.classificationRequirements ?? current.classificationRequirements;
  const knowledge = prompt?.knowledge ?? current.knowledge;
  const next: ArkSettings = {
    activeProvider: provider,
    providers: {
      ...current.providers,
      [provider]: {
        apiKey,
        model,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
      },
    },
    ...(classificationRequirements ? { classificationRequirements } : {}),
    ...(knowledge === undefined ? {} : { knowledge }),
  };
  await storage.set({ [STORAGE_KEY]: next });
  return next;
}

export async function activateProvider(
  storage: StorageArea,
  provider: ProviderId,
): Promise<ArkSettings> {
  const current = await loadSettings(storage);
  if (!current.providers[provider])
    throw new TypeError("Provider is not configured");
  const next = { ...current, activeProvider: provider };
  await storage.set({ [STORAGE_KEY]: next });
  return next;
}
