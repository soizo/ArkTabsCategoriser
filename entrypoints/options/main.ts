import "./style.css";
import { defaultSystemPrompt } from "../../src/categorisation";
import {
  ArkError,
  errorPayload,
  formatDiagnostic,
  type ArkDiagnostic,
  type ArkErrorCode,
  type ArkErrorPayload,
  type DiagnosticField,
} from "../../src/errors";
import { localiseDocument, msg, type MessageKey } from "../../src/i18n";
import {
  requestProviderPermission,
  type PermissionsPort,
} from "../../src/permissions";
import { getProvider } from "../../src/providers";
import {
  loadSettings,
  saveProvider,
  type ProviderSettings,
  type StorageArea,
} from "../../src/settings";
import type { ProviderId } from "../../src/domain";
import { modelPickerState } from "../../src/model-picker";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing options element: ${selector}`);
  return element;
}

const storage: StorageArea = {
  get: (key) => browser.storage.local.get(key),
  set: (value) => browser.storage.local.set(value),
};
const permissions: PermissionsPort = {
  request: (permission) => browser.permissions.request(permission),
  contains: (permission) => browser.permissions.contains(permission),
};

const form = required<HTMLFormElement>("#settings-form");
const apiKeyInput = required<HTMLInputElement>("#api-key");
const baseUrlInput = required<HTMLInputElement>("#base-url");
const baseUrlField = required<HTMLElement>("#base-url-field");
const modelInput = required<HTMLInputElement>("#model");
const modelPicker = required<HTMLSelectElement>("#model-picker");
const modelPickerLabel = required<HTMLLabelElement>("#model-picker-label");
const loadModelsButton = required<HTMLButtonElement>("#load-models");
const testModelButton = required<HTMLButtonElement>("#test-model");
const saveButton = required<HTMLButtonElement>("#save-settings");
const systemPromptInput = required<HTMLTextAreaElement>("#system-prompt");
const resetPromptButton = required<HTMLButtonElement>("#reset-prompt");
const status = required<HTMLElement>("#settings-status");
const outputPanel = required<HTMLElement>("#settings-output");
const outputContent = required<HTMLElement>("#settings-output-content");
const providerInputs = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="provider"]'),
];

let selected: ProviderId = "openai";
let drafts: Partial<Record<ProviderId, ProviderSettings>> = {};

const diagnosticLabels = {
  stage: "diagnosticStage",
  reason: "diagnosticReason",
  status: "diagnosticStatus",
  origin: "diagnosticOrigin",
  provider_message: "diagnosticProviderMessage",
  context: "diagnosticContext",
} as const satisfies Record<DiagnosticField, MessageKey>;

function clearOutput(): void {
  outputContent.textContent = "";
  outputPanel.hidden = true;
}

function showOutput(payload: ArkErrorPayload, fallback: ArkDiagnostic): void {
  outputContent.textContent = formatDiagnostic(
    payload.diagnostic ?? fallback,
    (field) => msg(diagnosticLabels[field]),
  );
  outputPanel.hidden = false;
}

function showFailure(
  error: unknown,
  fallbackCode: ArkErrorCode = "network",
  fallback: ArkDiagnostic = { stage: "request", reason: "request_failed" },
): void {
  showOutput(errorPayload(error, fallbackCode, fallback), fallback);
}

function setStatus(
  key: MessageKey | "",
  kind: "neutral" | "success" | "error" = "neutral",
  substitutions?: string | string[],
): void {
  status.textContent = key ? msg(key, substitutions) : "";
  status.dataset.kind = kind;
}

function readDraft(): ProviderSettings {
  const settings: ProviderSettings = {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
  };
  const baseUrl = baseUrlInput.value.trim();
  if (baseUrl) settings.baseUrl = baseUrl;
  return settings;
}

function captureDraft(): void {
  drafts[selected] = readDraft();
}

function renderProvider(): void {
  const draft = drafts[selected];
  apiKeyInput.value = draft?.apiKey ?? "";
  modelInput.value = draft?.model ?? "";
  baseUrlInput.value = draft?.baseUrl ?? "";
  baseUrlField.hidden = selected !== "custom";
  baseUrlInput.required = selected === "custom";
  for (const input of providerInputs) input.checked = input.value === selected;
  modelPicker.replaceChildren();
  modelPicker.hidden = true;
  modelPickerLabel.hidden = true;
  setStatus("");
  clearOutput();
}

function errorKey(error: unknown): MessageKey {
  if (!(error instanceof ArkError)) return "networkError";
  const keys: Partial<Record<ArkError["code"], MessageKey>> = {
    permission_denied: "permissionDenied",
    unauthorised: "unauthorised",
    forbidden: "modelForbidden",
    rate_limited: "rateLimited",
    timeout: "requestTimeout",
    invalid_response: "invalidProviderResponse",
    network: "networkError",
  };
  return keys[error.code] ?? "networkError";
}

async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted)
      throw new ArkError("timeout", {
        stage: "request",
        reason: "timeout",
      });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

for (const input of providerInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    captureDraft();
    selected = input.value as ProviderId;
    renderProvider();
  });
}

modelPicker.addEventListener("change", () => {
  if (modelPicker.value) modelInput.value = modelPicker.value;
});

resetPromptButton.addEventListener("click", () => {
  systemPromptInput.value = defaultSystemPrompt(browser.i18n.getUILanguage());
  setStatus("");
  clearOutput();
});

loadModelsButton.addEventListener("click", async () => {
  clearOutput();
  const providerSettings = readDraft();
  if (
    !providerSettings.apiKey ||
    (selected === "custom" && !providerSettings.baseUrl)
  ) {
    setStatus("invalidSettings", "error");
    showOutput(
      {
        errorCode: "not_configured",
        diagnostic: {
          stage: "configuration",
          reason: "invalid_configuration",
          context: "Provider settings were incomplete",
        },
      },
      { stage: "configuration", reason: "invalid_configuration" },
    );
    return;
  }

  loadModelsButton.disabled = true;
  setStatus("loadingModels");
  try {
    await requestProviderPermission(permissions, selected, providerSettings);
    const models = await runWithTimeout((signal) => {
      return getProvider(selected).listModels(providerSettings, signal);
    });
    const picker = modelPickerState(models, modelInput.value.trim());
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = msg("chooseLoadedModel");
    modelPicker.replaceChildren(
      placeholder,
      ...picker.options.map((model) => {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        return option;
      }),
    );
    modelPicker.value = picker.selected;
    modelPicker.hidden = picker.hidden;
    modelPickerLabel.hidden = picker.hidden;
    drafts[selected] = providerSettings;
    setStatus("modelsLoaded", "success", String(models.length));
  } catch (error) {
    setStatus(errorKey(error), "error");
    showFailure(error);
  } finally {
    loadModelsButton.disabled = false;
  }
});

testModelButton.addEventListener("click", async () => {
  clearOutput();
  const providerSettings = readDraft();
  if (
    !providerSettings.apiKey ||
    !providerSettings.model ||
    (selected === "custom" && !providerSettings.baseUrl)
  ) {
    setStatus("invalidSettings", "error");
    showOutput(
      {
        errorCode: "not_configured",
        diagnostic: {
          stage: "configuration",
          reason: "invalid_configuration",
          context: "Provider settings were incomplete",
        },
      },
      { stage: "configuration", reason: "invalid_configuration" },
    );
    return;
  }

  testModelButton.disabled = true;
  loadModelsButton.disabled = true;
  setStatus("testingModel");
  try {
    await requestProviderPermission(permissions, selected, providerSettings);
    await runWithTimeout((signal) =>
      getProvider(selected).testConnection(providerSettings, signal),
    );
    setStatus("modelTestSucceeded", "success");
  } catch (error) {
    setStatus(errorKey(error), "error");
    showFailure(error);
  } finally {
    testModelButton.disabled = false;
    loadModelsButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearOutput();
  if (!form.reportValidity()) return;

  const providerSettings = readDraft();
  saveButton.disabled = true;
  try {
    await requestProviderPermission(permissions, selected, providerSettings);
    const saved = await saveProvider(
      storage,
      selected,
      providerSettings,
      systemPromptInput.value,
    );
    drafts = { ...saved.providers };
    setStatus("settingsSaved", "success");
  } catch (error) {
    const invalidSettings = error instanceof TypeError;
    setStatus(invalidSettings ? "invalidSettings" : errorKey(error), "error");
    showFailure(
      error,
      invalidSettings ? "not_configured" : "network",
      invalidSettings
        ? { stage: "configuration", reason: "invalid_configuration" }
        : { stage: "request", reason: "request_failed" },
    );
  } finally {
    saveButton.disabled = false;
  }
});

localiseDocument();
const stored = await loadSettings(storage);
drafts = { ...stored.providers };
selected = stored.activeProvider ?? "openai";
systemPromptInput.value =
  stored.systemPrompt ?? defaultSystemPrompt(browser.i18n.getUILanguage());
renderProvider();
