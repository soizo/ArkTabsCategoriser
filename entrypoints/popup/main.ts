import "./style.css";
import type { ArkErrorCode } from "../../src/errors";
import type { ProviderId } from "../../src/domain";
import { localiseDocument, msg, type MessageKey } from "../../src/i18n";
import type { OrganisePortOutbound } from "../../src/messages";
import { popupView, type PopupState } from "../../src/popup-state";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

type PopupStateResponse = {
  ok: true;
  count: number;
  provider?: ProviderId;
  model?: string;
  configuredProviders: { provider: ProviderId; model: string }[];
};

type SimpleResponse =
  | { ok: true }
  | { ok: false; errorCode: ArkErrorCode };

const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  custom: "Custom",
};

const countElement = required<HTMLElement>("#tab-count");
const countLabel = required<HTMLElement>("#tab-count-label");
const modelControl = required<HTMLElement>("#model-control");
const modelElement = required<HTMLSelectElement>("#active-model");
const testModelButton = required<HTMLButtonElement>("#test-model");
const organiseButton = required<HTMLButtonElement>("#organise");
const organiseLabel = required<HTMLElement>("#organise-label");
const settingsButton = required<HTMLButtonElement>("#settings");
const statusElement = required<HTMLElement>("#popup-status");
const reasoningPanel = required<HTMLElement>("#reasoning-panel");
const reasoningContent = required<HTMLElement>("#reasoning-content");
const reasoningElapsed = required<HTMLElement>("#reasoning-elapsed");

let state: PopupState = { kind: "unconfigured", count: 0 };
let configuredProviders: PopupStateResponse["configuredProviders"] = [];
let active:
  | { providerId: ProviderId; provider: string; model: string }
  | undefined;
let reasoningStarted = 0;
let reasoningTimer: ReturnType<typeof setInterval> | undefined;

function clearReasoning(): void {
  if (reasoningTimer) clearInterval(reasoningTimer);
  reasoningTimer = undefined;
  reasoningStarted = 0;
  reasoningContent.textContent = "";
  reasoningElapsed.textContent = "";
  reasoningPanel.hidden = true;
}

function updateReasoningElapsed(): void {
  reasoningElapsed.textContent = `${(
    (performance.now() - reasoningStarted) /
    1000
  ).toFixed(1)} s`;
}

function appendReasoning(text: string): void {
  if (!text) return;
  if (reasoningPanel.hidden) {
    reasoningStarted = performance.now();
    updateReasoningElapsed();
    reasoningTimer = setInterval(updateReasoningElapsed, 100);
    reasoningPanel.hidden = false;
  }
  reasoningContent.textContent += text;
  reasoningContent.scrollTop = reasoningContent.scrollHeight;
}

function render(next: PopupState): void {
  state = next;
  const view = popupView(next);
  countElement.textContent = String(view.count);
  countLabel.textContent = msg("eligibleTabCount", String(view.count));
  modelControl.hidden = modelElement.options.length === 0;
  modelElement.hidden = modelElement.options.length === 0;
  testModelButton.hidden = modelElement.options.length === 0;
  modelElement.disabled = view.busy;
  testModelButton.disabled = view.busy;
  modelElement.title = modelElement.selectedOptions[0]?.textContent ?? "";
  organiseLabel.textContent = msg(view.buttonKey as MessageKey);
  organiseButton.disabled = view.buttonDisabled;
  organiseButton.setAttribute("aria-busy", String(view.busy));
  statusElement.textContent = view.statusKey
    ? msg(view.statusKey as MessageKey, view.statusSubstitution)
    : "";
  statusElement.dataset.kind =
    next.kind === "error"
      ? "error"
      : next.kind === "success"
        ? "success"
        : "neutral";
}

async function openOptions(): Promise<void> {
  await browser.runtime.sendMessage({ type: "openOptions" });
  window.close();
}

settingsButton.addEventListener("click", () => {
  void openOptions();
});

modelElement.addEventListener("change", async () => {
  const previousProvider = active?.providerId;
  const providerId = modelElement.value as ProviderId;
  const selected = configuredProviders.find(
    ({ provider }) => provider === providerId,
  );
  if (!selected) return;

  modelElement.disabled = true;
  try {
    await browser.runtime.sendMessage({
      type: "activateProvider",
      provider: providerId,
    });
    active = {
      providerId,
      provider: providerNames[providerId],
      model: selected.model,
    };
    render({
      kind: "ready",
      count: state.count,
      provider: active.provider,
      model: active.model,
    });
  } catch {
    if (previousProvider) modelElement.value = previousProvider;
    render({ kind: "error", count: state.count, code: "network" });
  }
});

testModelButton.addEventListener("click", async () => {
  if (!active) return;
  clearReasoning();
  render({
    kind: "testing",
    count: state.count,
    provider: active.provider,
    model: active.model,
  });
  try {
    const response = (await browser.runtime.sendMessage({
      type: "testModel",
    })) as SimpleResponse;
    if (!response.ok) {
      render({ kind: "error", count: state.count, code: response.errorCode });
      return;
    }
    render({
      kind: "ready",
      count: state.count,
      provider: active.provider,
      model: active.model,
    });
    statusElement.textContent = msg("modelTestSucceeded");
    statusElement.dataset.kind = "success";
  } catch {
    render({ kind: "error", count: state.count, code: "network" });
  }
});

organiseButton.addEventListener("click", async () => {
  if (state.kind === "unconfigured" || !active) {
    await openOptions();
    return;
  }

  render({
    kind: "working",
    count: state.count,
    provider: active.provider,
    model: active.model,
  });
  clearReasoning();
  const port = browser.runtime.connect({ name: "organise" });
  let settled = false;

  port.onMessage.addListener((message: OrganisePortOutbound) => {
    if (message.type === "reasoning") {
      appendReasoning(message.text);
      return;
    }
    settled = true;
    clearReasoning();
    if (message.type === "complete") {
      render({
        kind: "success",
        count: state.count,
        groupCount: message.groupCount,
        ungroupedCount: message.ungroupedCount,
      });
    } else {
      render({ kind: "error", count: state.count, code: message.errorCode });
    }
    port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    if (!settled) {
      clearReasoning();
      render({ kind: "error", count: state.count, code: "network" });
    }
  });
  port.postMessage({ type: "start" });
});

localiseDocument();
settingsButton.ariaLabel = msg("settings");
modelElement.ariaLabel = msg("activeModel");
render(state);

try {
  const response = (await browser.runtime.sendMessage({
    type: "popupState",
  })) as PopupStateResponse;
  configuredProviders = response.configuredProviders;
  modelElement.replaceChildren(
    ...configuredProviders.map(({ provider, model }) => {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = `${providerNames[provider]} · ${model}`;
      return option;
    }),
  );
  if (response.provider && response.model) {
    active = {
      providerId: response.provider,
      provider: providerNames[response.provider],
      model: response.model,
    };
    modelElement.value = response.provider;
    render({
      kind: "ready",
      count: response.count,
      provider: active.provider,
      model: active.model,
    });
  } else {
    render({ kind: "unconfigured", count: response.count });
  }
} catch {
  render({ kind: "error", count: 0, code: "network" });
}
