import "./style.css";
import {
  composeSystemPrompt,
  defaultClassificationRequirements,
} from "../../src/categorisation";
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
const inputTokenLimitInput = required<HTMLInputElement>("#input-token-limit");
const loadModelsButton = required<HTMLButtonElement>("#load-models");
const testModelButton = required<HTMLButtonElement>("#test-model");
const saveButton = required<HTMLButtonElement>("#save-settings");
const requirementsInput = required<HTMLTextAreaElement>(
  "#classification-requirements",
);
const knowledgeInput = required<HTMLTextAreaElement>("#knowledge");
const systemPromptInput = required<HTMLTextAreaElement>("#system-prompt");
const resetPromptButton = required<HTMLButtonElement>("#reset-prompt");
const copyPromptButton = required<HTMLButtonElement>("#copy-prompt");
const copyStatus = required<HTMLElement>("#prompt-copy-status");
const status = required<HTMLElement>("#settings-status");
const modelStatus = required<HTMLElement>("#model-status");
const modelFeedback = required<HTMLElement>("#model-feedback");
let modelRequestVersion = 0;
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

function showOutput(
  payload: ArkErrorPayload,
  fallback: ArkDiagnostic,
  model = false,
): void {
  if (model) modelFeedback.append(outputPanel);
  else required<HTMLElement>(".form-footer").before(outputPanel);
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
  model = false,
): void {
  showOutput(errorPayload(error, fallbackCode, fallback), fallback, model);
}

function setStatus(
  key: MessageKey | "",
  kind: "neutral" | "success" | "error" = "neutral",
  substitutions?: string | string[],
  target = status,
): void {
  target.textContent = key ? msg(key, substitutions) : "";
  target.dataset.kind = kind;
}

function setModelStatus(
  key: MessageKey | "",
  kind: "neutral" | "success" | "error" = "neutral",
  substitutions?: string | string[],
): void {
  setStatus(key, kind, substitutions, modelStatus);
}

function modelRequestCurrent(
  version: number,
  settings: ProviderSettings,
  test = false,
): boolean {
  const current = readDraft();
  return (
    version === modelRequestVersion &&
    current.apiKey === settings.apiKey &&
    current.baseUrl === settings.baseUrl &&
    (!test || current.model === settings.model)
  );
}

function readDraft(): ProviderSettings {
  const settings: ProviderSettings = {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
  };
  const baseUrl = baseUrlInput.value.trim();
  const inputTokenLimit = inputTokenLimitInput.valueAsNumber;
  if (baseUrl) settings.baseUrl = baseUrl;
  if (Number.isInteger(inputTokenLimit) && inputTokenLimit > 0) {
    settings.inputTokenLimit = inputTokenLimit;
  }
  return settings;
}

function captureDraft(): void {
  drafts[selected] = readDraft();
}

function renderProvider(): void {
  modelRequestVersion += 1;
  loadModelsButton.disabled = false;
  testModelButton.disabled = false;
  setModelStatus("");
  const draft = drafts[selected];
  apiKeyInput.value = draft?.apiKey ?? "";
  modelInput.value = draft?.model ?? "";
  baseUrlInput.value = draft?.baseUrl ?? "";
  inputTokenLimitInput.value = draft?.inputTokenLimit?.toString() ?? "";
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
    input_too_long: "inputTooLong",
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
  setModelStatus("");
  clearOutput();
});

for (const input of [apiKeyInput, baseUrlInput, modelInput]) {
  input.addEventListener("input", () => {
    setModelStatus("");
    clearOutput();
  });
}

function renderPrompt(): void {
  requirementsInput.setCustomValidity(
    requirementsInput.value.trim()
      ? ""
      : msg("classificationRequirementsRequired"),
  );
  systemPromptInput.value = composeSystemPrompt(
    browser.i18n.getUILanguage(),
    requirementsInput.value,
    knowledgeInput.value,
  );
  copyStatus.textContent = "";
}

for (const input of [requirementsInput, knowledgeInput]) {
  input.addEventListener("input", () => {
    renderPrompt();
    setStatus("");
  });
}

resetPromptButton.addEventListener("click", () => {
  requirementsInput.value = defaultClassificationRequirements(
    browser.i18n.getUILanguage(),
  );
  renderPrompt();
  setStatus("");
  clearOutput();
});

copyPromptButton.addEventListener("click", async () => {
  const text = systemPromptInput.value;
  copyPromptButton.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    if (systemPromptInput.value === text)
      copyStatus.textContent = msg("promptCopied");
  } catch {
    systemPromptInput.focus();
    systemPromptInput.select();
    copyStatus.textContent = msg("promptCopyFailed");
  } finally {
    copyPromptButton.disabled = false;
  }
});

loadModelsButton.addEventListener("click", async () => {
  clearOutput();
  const version = ++modelRequestVersion;
  const provider = selected;
  const providerSettings = readDraft();
  if (
    !providerSettings.apiKey ||
    (selected === "custom" && !providerSettings.baseUrl)
  ) {
    setModelStatus("invalidSettings", "error");
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
      true,
    );
    return;
  }

  loadModelsButton.disabled = true;
  testModelButton.disabled = true;
  setModelStatus("loadingModels");
  try {
    await requestProviderPermission(permissions, provider, providerSettings);
    if (!modelRequestCurrent(version, providerSettings)) return;
    const models = await runWithTimeout((signal) => {
      return getProvider(provider).listModels(providerSettings, signal);
    });
    if (!modelRequestCurrent(version, providerSettings)) return;
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
    drafts[provider] = readDraft();
    setModelStatus("modelsLoaded", "success", String(models.length));
  } catch (error) {
    if (!modelRequestCurrent(version, providerSettings)) return;
    setModelStatus(errorKey(error), "error");
    showFailure(
      error,
      "network",
      { stage: "request", reason: "request_failed" },
      true,
    );
  } finally {
    if (version === modelRequestVersion) {
      loadModelsButton.disabled = false;
      testModelButton.disabled = false;
    }
  }
});

testModelButton.addEventListener("click", async () => {
  clearOutput();
  const version = ++modelRequestVersion;
  const provider = selected;
  const providerSettings = readDraft();
  if (
    !providerSettings.apiKey ||
    !providerSettings.model ||
    (selected === "custom" && !providerSettings.baseUrl)
  ) {
    setModelStatus("invalidSettings", "error");
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
      true,
    );
    return;
  }

  testModelButton.disabled = true;
  loadModelsButton.disabled = true;
  setModelStatus("testingModel");
  try {
    await requestProviderPermission(permissions, provider, providerSettings);
    if (!modelRequestCurrent(version, providerSettings, true)) return;
    await runWithTimeout((signal) =>
      getProvider(provider).testConnection(providerSettings, signal),
    );
    if (modelRequestCurrent(version, providerSettings, true))
      setModelStatus("modelTestSucceeded", "success");
  } catch (error) {
    if (!modelRequestCurrent(version, providerSettings, true)) return;
    setModelStatus(errorKey(error), "error");
    showFailure(
      error,
      "network",
      { stage: "request", reason: "request_failed" },
      true,
    );
  } finally {
    if (version === modelRequestVersion) {
      testModelButton.disabled = false;
      loadModelsButton.disabled = false;
    }
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearOutput();
  if (!form.reportValidity()) return;

  const providerSettings = readDraft();
  const provider = selected;
  const prompt = {
    classificationRequirements: requirementsInput.value,
    knowledge: knowledgeInput.value,
  };
  saveButton.disabled = true;
  try {
    await requestProviderPermission(permissions, provider, providerSettings);
    const saved = await saveProvider(
      storage,
      provider,
      providerSettings,
      prompt,
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
requirementsInput.value =
  stored.classificationRequirements ??
  defaultClassificationRequirements(browser.i18n.getUILanguage());
knowledgeInput.value = stored.knowledge ?? "";
renderPrompt();
renderProvider();
