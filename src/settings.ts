import type { ProviderId } from "./domain";

export type ProviderSettings = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type ArkSettings = {
  activeProvider?: ProviderId;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
  systemPrompt?: string;
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
  return {
    apiKey: value.apiKey,
    model: value.model,
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl }),
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
  const systemPrompt =
    typeof stored.systemPrompt === "string" && stored.systemPrompt.trim()
      ? stored.systemPrompt
      : undefined;
  return {
    ...(activeProvider ? { activeProvider } : {}),
    providers,
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

export async function saveProvider(
  storage: StorageArea,
  provider: ProviderId,
  settings: ProviderSettings,
  systemPrompt?: string,
): Promise<ArkSettings> {
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();
  const baseUrl = settings.baseUrl?.trim();
  const prompt = systemPrompt?.trim();
  if (
    !apiKey ||
    !model ||
    (provider === "custom" && !baseUrl) ||
    (systemPrompt !== undefined && !prompt)
  ) {
    throw new TypeError("Incomplete provider settings");
  }

  const current = await loadSettings(storage);
  const next: ArkSettings = {
    activeProvider: provider,
    providers: {
      ...current.providers,
      [provider]: {
        apiKey,
        model,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      },
    },
    ...(prompt
      ? { systemPrompt: prompt }
      : current.systemPrompt
        ? { systemPrompt: current.systemPrompt }
        : {}),
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
