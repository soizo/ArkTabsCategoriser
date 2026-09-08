import "./style.css";
import {
  appendDiagnosticOutput,
  errorPayload,
  type ArkErrorPayload,
  type DiagnosticField,
} from "../../src/errors";
import type { ProviderId, TabGroupColor } from "../../src/domain";
import { localiseDocument, msg, type MessageKey } from "../../src/i18n";
import {
  REASONING_LIMIT,
  type OrganisePortOutbound,
  type OrganiseTask,
} from "../../src/messages";
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
const taskStatusElement = required<HTMLElement>("#popup-status");
const modelStatusElement = required<HTMLElement>("#model-status");
const stopButton = required<HTMLButtonElement>("#stop-organise");
let statusElement = taskStatusElement;
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
let currentTask: OrganiseTask | null = null;
let taskPort: ReturnType<typeof browser.runtime.connect> | undefined;
let windowId: number | undefined;
let eligibleCount = 0;
let reconnects = 0;
let taskConnected = false;

function taskRunning(): boolean {
  return (
    !!currentTask &&
    ["running", "applying", "stopping"].includes(currentTask.phase)
  );
}

function outputContext(model = false): void {
  statusElement = model ? modelStatusElement : taskStatusElement;
  if (model) modelControl.append(reasoningPanel);
  else taskStatusElement.before(reasoningPanel);
}

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
    (Date.now() - reasoningStarted) / 1000
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
    reasoningStarted = currentTask?.startedAt ?? Date.now();
    updateReasoningElapsed();
    reasoningTimer = setInterval(updateReasoningElapsed, 100);
    reasoningPanel.hidden = false;
  }
  reasoningContent.textContent = (
    (reasoningContent.textContent ?? "") + text
  ).slice(-REASONING_LIMIT);
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
  modelElement.disabled = view.busy || !taskConnected;
  testModelButton.disabled = view.busy || !taskConnected;
  renameFieldset.disabled = view.busy || !taskConnected;
  syncRenameButton();
  modelElement.title = modelElement.selectedOptions[0]?.textContent ?? "";
  organiseLabel.textContent = msg(view.buttonKey as MessageKey);
  organiseButton.disabled = view.buttonDisabled || !taskConnected;
  organiseButton.setAttribute("aria-busy", String(view.busy));
  statusElement.textContent = view.statusKey
    ? msg(view.statusKey as MessageKey, view.statusSubstitution)
    : "";
  statusElement.dataset.kind =
    next.kind === "error"
      ? next.code === "cancelled"
        ? "neutral"
        : "error"
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
  if (taskRunning()) return;
  outputContext(true);
  clearReasoning();
  const previousProvider = active?.providerId;
  const taskId = currentTask?.id;
  const providerId = modelElement.value as ProviderId;
  const selected = configuredProviders.find(
    ({ provider }) => provider === providerId,
  );
  if (!selected) return;

  modelElement.disabled = true;
  testModelButton.disabled = true;
  organiseButton.disabled = true;
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
    if (currentTask?.id !== taskId || taskRunning()) return;
    render({
      kind: "ready",
      count: state.count,
      provider: active.provider,
      model: active.model,
    });
  } catch {
    if (currentTask?.id !== taskId || taskRunning()) return;
    if (previousProvider) modelElement.value = previousProvider;
    render({ kind: "error", count: state.count, code: "network" });
    appendError(runtimeFailure());
  }
});

testModelButton.addEventListener("click", async () => {
  if (!active || taskRunning()) return;
  const taskId = currentTask?.id;
  outputContext(true);
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
    if (currentTask?.id !== taskId || taskRunning()) return;
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
    if (currentTask?.id !== taskId || taskRunning()) return;
    render({ kind: "error", count: state.count, code: "network" });
    appendError(runtimeFailure());
  }
});

renameSubmit.addEventListener("click", async () => {
  if (taskRunning()) return;
  outputContext();
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

function renderTask(
  message: Extract<OrganisePortOutbound, { type: "state" }>,
): void {
  const previousId = currentTask?.id;
  currentTask = message.task;
  if (!currentTask) {
    stopButton.hidden = true;
    required<HTMLElement>(".tab-summary-copy span").textContent =
      msg("eligibleTabScope");
    if (previousId) {
      outputContext();
      clearReasoning();
    }
    render(
      previousId
        ? { kind: "error", count: eligibleCount, code: "interrupted" }
        : state,
    );
    return;
  }
  const task = currentTask;
  outputContext();
  clearReasoning();
  stopButton.hidden = !taskRunning();
  stopButton.disabled = task.phase !== "running" || !taskPort;
  stopButton.textContent = msg(
    task.phase === "stopping" ? "stoppingTabs" : "stopOrganising",
  );
  required<HTMLElement>(".tab-summary-copy span").textContent = msg(
    taskRunning() ? "taskWindowScope" : "eligibleTabScope",
  );
  const choices = [...configuredProviders];
  if (taskRunning() && task.info) {
    const index = choices.findIndex(
      (item) => item.provider === task.info!.provider,
    );
    const choice = { provider: task.info.provider, model: task.info.model };
    if (index < 0) choices.push(choice);
    else choices[index] = choice;
  }
  modelElement.replaceChildren(
    ...choices.map(({ provider, model }) => {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = `${providerNames[provider]} · ${model}`;
      return option;
    }),
  );
  modelElement.value =
    (taskRunning() ? task.info?.provider : active?.providerId) ??
    active?.providerId ??
    "";
  if (taskRunning()) {
    render({
      kind: "working",
      count: task.info?.count ?? eligibleCount,
      provider: task.info
        ? providerNames[task.info.provider]
        : (active?.provider ?? ""),
      model: task.info?.model ?? active?.model ?? "",
    });
    statusElement.textContent = msg(
      task.phase === "applying"
        ? "applyingGroups"
        : task.phase === "stopping"
          ? "stoppingTabs"
          : "backgroundOrganising",
    );
    appendReasoning(message.reasoning);
    if (task.phase !== "running") {
      if (reasoningTimer) clearInterval(reasoningTimer);
      reasoningTimer = undefined;
      reasoningPulse.hidden = true;
      reasoningHeading.textContent = msg("output");
    }
  } else if (task.phase === "complete" && task.result) {
    render({ kind: "success", count: eligibleCount, ...task.result });
    if (task.windowId !== windowId)
      statusElement.prepend(msg("otherWindowResult"));
    // Refresh rename controls after grouping, without overwriting the task result.
    void browser.runtime
      .sendMessage({ type: "popupState" })
      .then((response: PopupStateResponse) => {
        if (currentTask?.id !== task.id || taskRunning()) return;
        groups = response.groups;
        renderGroups();
      })
      .catch(() => {});
  } else if (task.phase === "cancelled") {
    render({ kind: "error", count: eligibleCount, code: "cancelled" });
  } else {
    const failure = task.error ?? runtimeFailure();
    render({ kind: "error", count: eligibleCount, code: failure.errorCode });
    appendReasoning(message.reasoning);
    appendError(failure);
  }
  if (previousId !== task.id) modelStatusElement.textContent = "";
}

function disconnected(): void {
  outputContext();
  stopButton.disabled = true;
  if (reasoningTimer) clearInterval(reasoningTimer);
  reasoningTimer = undefined;
  reasoningPulse.hidden = true;
  statusElement.textContent = msg("taskConnectionLost");
  statusElement.dataset.kind = "error";
  organiseButton.disabled = false;
  organiseButton.setAttribute("aria-busy", "false");
  organiseLabel.textContent = msg("reconnectTask");
}

function connectTask(): void {
  taskConnected = false;
  organiseButton.disabled = true;
  testModelButton.disabled = true;
  modelElement.disabled = true;
  try {
    const port = browser.runtime.connect({ name: "organise" });
    taskPort = port;
    port.onMessage.addListener((message: OrganisePortOutbound) => {
      if (taskPort !== port) return;
      if (message.type === "reasoning") appendReasoning(message.text);
      else {
        taskConnected = true;
        renderTask(message);
      }
    });
    port.onDisconnect.addListener(() => {
      if (taskPort !== port) return;
      taskPort = undefined;
      taskConnected = false;
      if (reconnects++ === 0) connectTask();
      else disconnected();
    });
  } catch {
    taskPort = undefined;
    disconnected();
  }
}

stopButton.addEventListener("click", () => {
  if (!taskPort || currentTask?.phase !== "running") return;
  stopButton.disabled = true;
  try {
    taskPort.postMessage({ type: "stop", id: currentTask.id });
  } catch {
    taskPort = undefined;
    disconnected();
  }
});

organiseButton.addEventListener("click", async () => {
  if (!taskPort) {
    reconnects = 0;
    connectTask();
    return;
  }
  if (!taskConnected || taskRunning()) return;
  if (state.kind === "unconfigured" || !active) {
    await openOptions();
    return;
  }
  if (windowId === undefined) return;
  outputContext();
  clearReasoning();
  render({
    kind: "working",
    count: eligibleCount,
    provider: active.provider,
    model: active.model,
  });
  try {
    taskPort.postMessage({ type: "start", windowId });
  } catch {
    taskPort = undefined;
    disconnected();
  }
});

localiseDocument();
settingsButton.ariaLabel = msg("settings");
modelElement.ariaLabel = msg("activeModel");
render(state);

try {
  windowId = (await browser.windows.getCurrent()).id;
  const response = (await browser.runtime.sendMessage({
    type: "popupState",
  })) as PopupStateResponse;
  eligibleCount = response.count;
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
  connectTask();
} catch {
  render({ kind: "error", count: 0, code: "network" });
  appendError(runtimeFailure());
}
