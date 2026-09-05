import { describe, expect, it } from "vitest";
import { popupView, type PopupState } from "../src/popup-state";

describe("popupView", () => {
  it("turns an unconfigured extension into a settings action", () => {
    expect(popupView({ kind: "unconfigured", count: 12 })).toEqual({
      count: 12,
      model: "",
      buttonKey: "openSettings",
      statusKey: "providerNotConfigured",
      buttonDisabled: false,
      busy: false,
    });
  });

  it("disables organisation when fewer than two tabs are eligible", () => {
    expect(
      popupView({
        kind: "ready",
        count: 1,
        provider: "OpenAI",
        model: "gpt-4.1",
      }),
    ).toMatchObject({
      buttonKey: "organiseTabs",
      statusKey: "nothingToOrganise",
      buttonDisabled: true,
    });
  });

  it("shows the active provider and model in the ready state", () => {
    expect(
      popupView({
        kind: "ready",
        count: 8,
        provider: "OpenRouter",
        model: "anthropic/claude-sonnet-4",
      }),
    ).toMatchObject({
      model: "OpenRouter · anthropic/claude-sonnet-4",
      buttonKey: "organiseTabs",
      statusKey: "",
      buttonDisabled: false,
    });
  });

  it("prevents duplicate requests while working", () => {
    expect(
      popupView({
        kind: "working",
        count: 8,
        provider: "OpenRouter",
        model: "model",
      }),
    ).toMatchObject({
      buttonKey: "organisingTabs",
      statusKey: "sendingTabData",
      buttonDisabled: true,
      busy: true,
    });
  });

  it("disables organisation while testing the model", () => {
    expect(
      popupView({
        kind: "testing",
        count: 8,
        provider: "OpenRouter",
        model: "openrouter/free",
      }),
    ).toMatchObject({
      model: "OpenRouter · openrouter/free",
      buttonKey: "organiseTabs",
      statusKey: "testingModel",
      buttonDisabled: true,
      busy: true,
    });
  });

  it("reports grouped and ungrouped counts after success", () => {
    expect(
      popupView({
        kind: "success",
        count: 8,
        groupCount: 3,
        ungroupedCount: 2,
      }),
    ).toMatchObject({
      buttonKey: "organiseAgain",
      statusKey: "organisedGroupCount",
      statusSubstitution: ["3", "2"],
      buttonDisabled: false,
    });
  });

  it.each([
    ["permission_denied", "permissionDenied"],
    ["unauthorised", "unauthorised"],
    ["forbidden", "modelForbidden"],
    ["rate_limited", "rateLimited"],
    ["timeout", "requestTimeout"],
    ["invalid_response", "invalidProviderResponse"],
    ["input_too_long", "inputTooLong"],
    ["tabs_changed", "tabsChanged"],
    ["grouping_failed", "groupingFailed"],
    ["network", "networkError"],
  ] as const)("maps %s to actionable copy", (code, statusKey) => {
    const state: PopupState = { kind: "error", count: 8, code };
    expect(popupView(state)).toMatchObject({
      statusKey,
      buttonDisabled: false,
    });
  });
});
