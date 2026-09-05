import type { ProviderId } from './domain';
import { ArkError } from './errors';
import type { ProviderSettings } from './settings';

export type PermissionOrigins = { origins: string[] };

export type PermissionsPort = {
  request(permission: PermissionOrigins): Promise<boolean>;
  contains(permission: PermissionOrigins): Promise<boolean>;
};

const FIXED_ORIGINS: Record<Exclude<ProviderId, 'custom'>, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
};

export function providerOrigin(
  provider: ProviderId,
  settings: ProviderSettings,
): string {
  if (provider !== 'custom') return FIXED_ORIGINS[provider];
  if (!settings.baseUrl) throw new TypeError('Custom base URL is required');

  let url: URL;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    throw new TypeError('Custom base URL is invalid');
  }

  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Custom base URL must use HTTPS or loopback HTTP');
  }
  return url.origin;
}

function originPermission(provider: ProviderId, settings: ProviderSettings): PermissionOrigins {
  return { origins: [`${providerOrigin(provider, settings)}/*`] };
}

export async function requestProviderPermission(
  permissions: PermissionsPort,
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<void> {
  const origin = providerOrigin(provider, settings);
  if (!(await permissions.request({ origins: [`${origin}/*`] }))) {
    throw new ArkError("permission_denied", {
      stage: "permission",
      reason: "permission_denied",
      origin,
    });
  }
}

export async function hasProviderPermission(
  permissions: PermissionsPort,
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<boolean> {
  return permissions.contains(originPermission(provider, settings));
}
