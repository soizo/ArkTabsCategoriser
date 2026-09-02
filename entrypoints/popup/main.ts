import "./style.css";
import type { ArkErrorCode } from "../../src/errors";
import type { ProviderId } from "../../src/domain";
import { localiseDocument, msg, type MessageKey } from "../../src/i18n";
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
};

type OrganiseResponse =
  | { ok: true; groupCount: number; ungroupedCount: number }
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
const modelElement = required<HTMLElement>("#active-model");
const organiseButton = required<HTMLButtonElement>("#organise");
const settingsButton = required<HTMLButtonElement>("#settings");
const statusElement = required<HTMLElement>("#popup-status");

let state: PopupState = { kind: "unconfigured", count: 0 };
let active: { provider: string; model: string } | undefined;

function render(next: PopupState): void {
  state = next;
  const view = popupView(next);
  countElement.textContent = String(view.count);
  countLabel.textContent = msg("eligibleTabCount", String(view.count));
  modelElement.textContent = view.model;
  modelElement.title = view.model;
  modelElement.hidden = !view.model;
  organiseButton.textContent = msg(view.buttonKey as MessageKey);
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

organiseButton.addEventListener("click", async () => {
  if (state.kind === "unconfigured" || !active) {
    await openOptions();
    return;
  }

  render({ kind: "working", count: state.count, ...active });
  try {
    const response = (await browser.runtime.sendMessage({
      type: "organise",
    })) as OrganiseResponse;
    if (response.ok) {
      render({
        kind: "success",
        count: state.count,
        groupCount: response.groupCount,
        ungroupedCount: response.ungroupedCount,
      });
    } else {
      render({ kind: "error", count: state.count, code: response.errorCode });
    }
  } catch {
    render({ kind: "error", count: state.count, code: "network" });
  }
});

localiseDocument();
settingsButton.ariaLabel = msg("settings");
render(state);

try {
  const response = (await browser.runtime.sendMessage({
    type: "popupState",
  })) as PopupStateResponse;
  if (response.provider && response.model) {
    active = {
      provider: providerNames[response.provider],
      model: response.model,
    };
    render({ kind: "ready", count: response.count, ...active });
  } else {
    render({ kind: "unconfigured", count: response.count });
  }
} catch {
  render({ kind: "error", count: 0, code: "network" });
}
