import type { ArkErrorCode } from "./errors";

export type PopupState =
  | { kind: "unconfigured"; count: number }
  | { kind: "ready"; count: number; provider: string; model: string }
  | { kind: "testing"; count: number; provider: string; model: string }
  | { kind: "working"; count: number; provider: string; model: string }
  | {
      kind: "success";
      count: number;
      groupCount: number;
      ungroupedCount: number;
    }
  | { kind: "error"; count: number; code: ArkErrorCode };

export type PopupMessageKey =
  | "openSettings"
  | "organiseTabs"
  | "organisingTabs"
  | "testingModel"
  | "organiseAgain"
  | "providerNotConfigured"
  | "nothingToOrganise"
  | "sendingTabData"
  | "organisedGroupCount"
  | "permissionDenied"
  | "unauthorised"
  | "modelForbidden"
  | "rateLimited"
  | "requestTimeout"
  | "invalidProviderResponse"
  | "tabsChanged"
  | "groupingFailed"
  | "networkError";

export type PopupView = {
  count: number;
  model: string;
  buttonKey: PopupMessageKey;
  statusKey: PopupMessageKey | "";
  statusSubstitution?: string | string[];
  buttonDisabled: boolean;
  busy: boolean;
};

const ERROR_KEYS: Record<ArkErrorCode, PopupMessageKey> = {
  not_configured: "providerNotConfigured",
  permission_denied: "permissionDenied",
  unauthorised: "unauthorised",
  forbidden: "modelForbidden",
  rate_limited: "rateLimited",
  timeout: "requestTimeout",
  network: "networkError",
  invalid_response: "invalidProviderResponse",
  tabs_changed: "tabsChanged",
  grouping_failed: "groupingFailed",
};

export function popupView(state: PopupState): PopupView {
  if (state.kind === "unconfigured") {
    return {
      count: state.count,
      model: "",
      buttonKey: "openSettings",
      statusKey: "providerNotConfigured",
      buttonDisabled: false,
      busy: false,
    };
  }

  if (state.kind === "testing") {
    return {
      count: state.count,
      model: `${state.provider} · ${state.model}`,
      buttonKey: "organiseTabs",
      statusKey: "testingModel",
      buttonDisabled: true,
      busy: true,
    };
  }

  if (state.kind === "working") {
    return {
      count: state.count,
      model: `${state.provider} · ${state.model}`,
      buttonKey: "organisingTabs",
      statusKey: "sendingTabData",
      buttonDisabled: true,
      busy: true,
    };
  }

  if (state.kind === "success") {
    return {
      count: state.count,
      model: "",
      buttonKey: "organiseAgain",
      statusKey: "organisedGroupCount",
      statusSubstitution: [
        String(state.groupCount),
        String(state.ungroupedCount),
      ],
      buttonDisabled: false,
      busy: false,
    };
  }

  if (state.kind === "error") {
    return {
      count: state.count,
      model: "",
      buttonKey: "organiseAgain",
      statusKey: ERROR_KEYS[state.code],
      buttonDisabled: false,
      busy: false,
    };
  }

  return {
    count: state.count,
    model: `${state.provider} · ${state.model}`,
    buttonKey: "organiseTabs",
    statusKey: state.count < 2 ? "nothingToOrganise" : "",
    buttonDisabled: state.count < 2,
    busy: false,
  };
}
