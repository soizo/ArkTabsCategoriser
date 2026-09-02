import type { ProviderId } from './domain';

export type ProviderSettings = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type ArkSettings = {
  activeProvider?: ProviderId;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
};

export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

const STORAGE_KEY = 'arkSettings';
const PROVIDERS: ProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'custom',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProviderSettings(value: unknown): ProviderSettings | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.apiKey !== 'string' || typeof value.model !== 'string') {
    return undefined;
  }
  if (value.baseUrl !== undefined && typeof value.baseUrl !== 'string') {
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
  if (!isRecord(stored) || !isRecord(stored.providers)) return { providers: {} };

  const providers: ArkSettings['providers'] = {};
  for (const provider of PROVIDERS) {
    const settings = readProviderSettings(stored.providers[provider]);
    if (settings) providers[provider] = settings;
  }

  const activeProvider = PROVIDERS.find(
    (provider) => provider === stored.activeProvider && providers[provider],
  );
  return activeProvider ? { activeProvider, providers } : { providers };
}

export async function saveProvider(
  storage: StorageArea,
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<ArkSettings> {
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();
  const baseUrl = settings.baseUrl?.trim();
  if (!apiKey || !model || (provider === 'custom' && !baseUrl)) {
    throw new TypeError('Incomplete provider settings');
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
  };
  await storage.set({ [STORAGE_KEY]: next });
  return next;
}
