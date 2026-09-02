import type { ProviderId } from "./domain";
import { ArkError } from "./errors";
import { hasProviderPermission, type PermissionsPort } from "./permissions";
import type { Provider } from "./providers/types";
import { loadSettings, type StorageArea } from "./settings";

export type ModelTestDeps = {
  storage: StorageArea;
  permissions: PermissionsPort;
  providerFor(id: ProviderId): Provider;
  timeoutMs?: number;
};

export async function testActiveModel(deps: ModelTestDeps): Promise<void> {
  const stored = await loadSettings(deps.storage);
  const providerId = stored.activeProvider;
  const settings = providerId ? stored.providers[providerId] : undefined;
  if (!providerId || !settings) throw new ArkError("not_configured");
  if (!(await hasProviderPermission(deps.permissions, providerId, settings))) {
    throw new ArkError("permission_denied");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? 60_000,
  );
  try {
    await deps
      .providerFor(providerId)
      .testConnection(settings, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new ArkError("timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
