import "./style.css";
import {
  appendDiagnosticOutput,
  errorPayload,
  type ArkErrorPayload,
  type DiagnosticField,
} from "../../src/errors";
import type { ProviderId, TabGroupColor } from "../../src/domain";
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
  groups: { id: number; title?: string; color: TabGroupColor }[];
};

type SimpleResponse = { ok: true } | ({ ok: false } & ArkErrorPayload);

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
const renameControl = required<HTMLDetailsElement>("#rename-control");
const renameSummary = required<HTMLElement>("#rename-control summary");
const renameFieldset = required<HTMLFieldSetElement>("#rename-fieldset");
const renameList = required<HTMLElement>("#rename-list");
const renameSubmit = required<HTMLButtonElement>("#rename-submit");
const settingsButton = required<HTMLButtonElement>("#settings");
const statusElement = required<HTMLElement>("#popup-status");
const reasoningPanel = required<HTMLElement>("#reasoning-panel");
const reasoningHeading = required<HTMLElement>("#reasoning-heading");
const reasoningPulse = required<HTMLElement>("#reasoning-pulse");
const reasoningContent = required<HTMLElement>("#reasoning-content");
const reasoningElapsed = required<HTMLElement>("#reasoning-elapsed");

let state: PopupState = { kind: "unconfigured", count: 0 };
let configuredProviders: PopupStateResponse["configuredProviders"] = [];
let groups: PopupStateResponse["groups"] = [];
let active:
  | { providerId: ProviderId; provider: string; model: string }
  | undefined;
let reasoningStarted = 0;
let reasoningTimer: ReturnType<typeof setInterval> | undefined;

const diagnosticLabels = {
  stage: "diagnosticStage",
  reason: "diagnosticReason",
  status: "diagnosticStatus",
  origin: "diagnosticOrigin",
  provider_message: "diagnosticProviderMessage",
  context: "diagnosticContext",
} as const satisfies Record<DiagnosticField, MessageKey>;

function clearReasoning(): void {
  if (reasoningTimer) clearInterval(reasoningTimer);
  reasoningTimer = undefined;
  reasoningStarted = 0;
  reasoningContent.textContent = "";
  reasoningElapsed.textContent = "";
  reasoningHeading.textContent = msg("modelReasoning");
  reasoningPulse.hidden = false;
  reasoningPanel.dataset.kind = "reasoning";
  reasoningPanel.hidden = true;
}

function updateReasoningElapsed(): void {
  reasoningElapsed.textContent = `${(
    (performance.now() - reasoningStarted) / 1000
  ).toFixed(1)} s`;
}

function appendError(payload: ArkErrorPayload): void {
  if (reasoningTimer) clearInterval(reasoningTimer);
  reasoningTimer = undefined;
  const diagnostic = payload.diagnostic ?? {
    stage: "transport",
    reason: "request_failed",
  };
  reasoningHeading.textContent = msg("output");
  reasoningPulse.hidden = true;
  reasoningPanel.dataset.kind = "error";
  reasoningPanel.hidden = false;
  reasoningContent.textContent = appendDiagnosticOutput(
    reasoningContent.textContent ?? "",
    diagnostic,
    (field) => msg(diagnosticLabels[field]),
  );
  reasoningContent.scrollTop = reasoningContent.scrollHeight;
}

function runtimeFailure(): ArkErrorPayload {
  return errorPayload(undefined, "network", {
    stage: "transport",
    reason: "request_failed",
  });
}

function syncRenameButton(): void {
  const selected = [
    ...renameList.querySelectorAll<HTMLInputElement>(
      "input[type=checkbox]:checked",
    ),
  ];
  renameSubmit.disabled =
    renameFieldset.disabled ||
    selected.length === 0 ||
    selected.some((checkbox) => {
      const input = renameList.querySelector<HTMLInputElement>(
        `input[type=text][data-group-id="${checkbox.value}"]`,
      );
      return !input?.value.trim();
    });
}

function renderGroups(): void {
  renameControl.hidden = groups.length === 0;
  renameSummary.textContent = `${msg("renameGroups")} (${groups.length})`;
  renameList.replaceChildren(
    ...groups.map((group, index) => {
      const row = document.createElement("div");
      row.className = "rename-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(group.id);
      checkbox.ariaLabel = msg(
        "renameGroupSelection",
        group.title?.trim() || `${msg("groupName")} ${index + 1}`,
      );

      const color = document.createElement("span");
      color.className = "group-color";
      color.dataset.color = group.color;
      color.ariaHidden = "true";

      const input = document.createElement("input");
      input.type = "text";
      input.dataset.groupId = String(group.id);
      input.value = group.title ?? "";
      input.placeholder = msg("groupName");
      input.ariaLabel = msg("groupName");
      input.disabled = true;

      checkbox.addEventListener("change", () => {
        input.disabled = !checkbox.checked;
        syncRenameButton();
        if (checkbox.checked) input.focus();
      });
      input.addEventListener("input", syncRenameButton);
      row.append(checkbox, color, input);
      return row;
    }),
  );
  syncRenameButton();
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
  renameFieldset.disabled = view.busy;
  syncRenameButton();
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
  clearReasoning();
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
    appendError(runtimeFailure());
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
      appendError(response);
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
    appendError(runtimeFailure());
  }
});

renameSubmit.addEventListener("click", async () => {
  const renames = [
    ...renameList.querySelectorAll<HTMLInputElement>(
      "input[type=checkbox]:checked",
    ),
  ].map((checkbox) => ({
    id: Number(checkbox.value),
    title:
      renameList
        .querySelector<HTMLInputElement>(
          `input[type=text][data-group-id="${checkbox.value}"]`,
        )
        ?.value.trim() ?? "",
  }));
  if (renames.length === 0 || renames.some(({ title }) => !title)) {
    statusElement.textContent = msg("groupNameRequired");
    statusElement.dataset.kind = "error";
    return;
  }

  clearReasoning();
  renameFieldset.disabled = true;
  modelElement.disabled = true;
  testModelButton.disabled = true;
  organiseButton.disabled = true;
  let failure: ArkErrorPayload | undefined;
  try {
    const response = (await browser.runtime.sendMessage({
      type: "renameGroups",
      renames,
    })) as SimpleResponse;
    if (!response.ok) failure = response;
  } catch {
    failure = errorPayload(undefined, "grouping_failed", {
      stage: "transport",
      reason: "request_failed",
    });
  } finally {
    renameFieldset.disabled = false;
    render(state);
  }

  if (failure) {
    statusElement.textContent = msg("groupingFailed");
    statusElement.dataset.kind = "error";
    appendError(failure);
    syncRenameButton();
    return;
  }

  const titles = new Map(renames.map(({ id, title }) => [id, title]));
  groups = groups.map((group) => ({
    ...group,
    title: titles.get(group.id) ?? group.title,
  }));
  renderGroups();
  renameControl.open = false;
  statusElement.textContent = msg("groupsRenamed", String(renames.length));
  statusElement.dataset.kind = "success";
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
    if (message.type === "complete") {
      clearReasoning();
      render({
        kind: "success",
        count: state.count,
        groupCount: message.groupCount,
        ungroupedCount: message.ungroupedCount,
      });
    } else {
      render({ kind: "error", count: state.count, code: message.errorCode });
      appendError(message);
    }
    port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    if (!settled) {
      render({ kind: "error", count: state.count, code: "network" });
      appendError(runtimeFailure());
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
  groups = response.groups;
  renderGroups();
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
  appendError(runtimeFailure());
}
