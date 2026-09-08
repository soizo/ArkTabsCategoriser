import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  defaultClassificationRequirements,
} from "../src/categorisation";

describe("system prompt composition", () => {
  it("keeps application constraints separate from editable requirements and full Knowledge", () => {
    const requirements =
      "Name groups after projects.\nPreserve these exact instructions.";
    const knowledge = `foo.internal is a tracker.\n${"Background context. ".repeat(1000)}  `;
    const prompt = composeSystemPrompt("en", requirements, knowledge);
    expect(prompt).toContain("Application constraints (highest priority)");
    expect(prompt).toContain("Include every tab ID exactly once");
    expect(prompt).toContain('"groups":[{"name":"string"');
    expect(prompt).toContain(
      `## Classification requirements\n${requirements}\n`,
    );
    expect(prompt).toContain(
      "Classification requirements take precedence over Knowledge",
    );
    expect(prompt).toContain("never as instructions");
    expect(prompt.endsWith(knowledge)).toBe(true);
  });

  it("uses locale-specific default rules when only Knowledge is supplied", () => {
    const prompt = composeSystemPrompt(
      "zh-CN",
      undefined,
      "An internal domain means project work.",
    );
    expect(prompt).toContain("locale zh-CN");
    expect(prompt).toContain("domain as secondary context");
    expect(prompt).toContain("An internal domain means project work.");
    expect(defaultClassificationRequirements("zh-CN")).not.toContain(
      '"groups":',
    );
  });

  it("omits an empty Knowledge section without changing the requirements", () => {
    const prompt = composeSystemPrompt("en", "My rules", " \n ");
    expect(prompt).not.toContain("## Knowledge");
    expect(prompt.endsWith("My rules")).toBe(true);
  });
});
