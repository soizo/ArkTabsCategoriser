import { describe, expect, it } from "vitest";
import { modelPickerState } from "../src/model-picker";

describe("model picker", () => {
  it("exposes every loaded model through a real select", () => {
    const models = Array.from({ length: 421 }, (_, index) => `model-${index}`);

    expect(modelPickerState(models, "model-20")).toEqual({
      hidden: false,
      options: models,
      selected: "model-20",
    });
  });

  it("keeps a freely typed model when it is not in the loaded list", () => {
    expect(modelPickerState(["listed-model"], "my-custom-model")).toEqual({
      hidden: false,
      options: ["listed-model"],
      selected: "",
    });
  });
});
