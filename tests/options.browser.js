// Playwright MCP: open the locally served production options.html, then run
// browser_run_code_unsafe with this file's absolute filename. No live API calls.
async function checkOptions(page) {
  const base = await page.evaluate(() => location.origin);
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) {
    throw new Error(
      "Run this check on a local build, never a real extension profile",
    );
  }
  page = await page.context().newPage();
  const messages = {};
  for (const locale of ["en", "zh_CN"]) {
    messages[locale] = await (
      await page.request.get(`${base}/_locales/${locale}/messages.json`)
    ).json();
  }
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  let networkCalls = 0;
  await page.route("https://**/*", (route) => {
    networkCalls += 1;
    return route.abort();
  });
  await page.addInitScript(
    ({ messages }) => {
      const locale =
        new URL(location.href).searchParams.get("uiLocale") || "en";
      const initial = {
        activeProvider: "openai",
        providers: { openai: { apiKey: "test-key", model: "test-model" } },
        systemPrompt: "Legacy requirements\nKeep Work focused.",
      };
      window.browser = {
        runtime: { id: "ark-options-ui-test" },
        i18n: {
          getUILanguage: () => (locale === "zh_CN" ? "zh-CN" : "en"),
          getMessage: (key) => messages[locale]?.[key]?.message || key,
        },
        permissions: { request: async () => true, contains: async () => true },
        storage: {
          local: {
            get: async () => ({
              arkSettings: JSON.parse(
                sessionStorage.getItem("ark-ui-fixture") ||
                  JSON.stringify(initial),
              ),
            }),
            set: async (value) =>
              sessionStorage.setItem(
                "ark-ui-fixture",
                JSON.stringify(value.arkSettings),
              ),
          },
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            if (window.arkClipboardDenied) throw new Error("Clipboard denied");
            window.arkCopiedText = text;
          },
        },
      });
    },
    { messages },
  );
  await page.goto(`${base}/options.html`);
  await page.locator("#api-key").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#api-key")?.value === "test-key",
  );
  assert(
    (await page.locator("#classification-requirements").count()) === 1,
    "Missing classification requirements editor",
  );
  const requirements = page.locator("#classification-requirements");
  const knowledge = page.locator("#knowledge");
  const preview = page.locator("#system-prompt");
  assert(
    (await requirements.inputValue()) ===
      "Legacy requirements\nKeep Work focused.",
    "Legacy prompt was not preserved",
  );
  assert(
    (await knowledge.inputValue()) === "",
    "Knowledge must initially be empty",
  );
  assert(
    (await preview.getAttribute("readonly")) !== null,
    "Final prompt must be read-only",
  );
  const custom = "Group by research topic; use short group names.";
  const context =
    "foo.internal is our project tracker, not a documentation website.";
  await requirements.fill(custom);
  await knowledge.fill(context);
  const finalPrompt = await preview.inputValue();
  assert(
    finalPrompt.includes(custom) &&
      finalPrompt.includes(context) &&
      finalPrompt.includes('"ungroupedTabIds"'),
    "Preview did not compose rules, Knowledge and constraints",
  );
  await page
    .locator('.provider-switch label:has(input[value="anthropic"])')
    .click();
  await page
    .locator('.provider-switch label:has(input[value="openai"])')
    .click();
  assert(
    (await preview.inputValue()) === finalPrompt,
    "Switching provider lost global prompt drafts",
  );
  await page.locator("#copy-prompt").click();
  assert(
    (await page.evaluate(() => window.arkCopiedText)) === finalPrompt,
    "Copy differs from final preview",
  );
  await page.evaluate(() => {
    window.arkClipboardDenied = true;
  });
  await page.locator("#copy-prompt").click();
  assert(
    (await page.locator("#prompt-copy-status").innerText()).includes(
      messages.en.promptCopyFailed.message,
    ),
    "Clipboard failure has no recovery guidance",
  );
  await page.locator("#reset-prompt").click();
  assert(
    (await requirements.inputValue()).includes("domain as secondary context"),
    "Restore did not restore classification defaults",
  );
  assert(
    (await knowledge.inputValue()) === context,
    "Restore erased Knowledge",
  );
  await requirements.fill("  ");
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    () => !document.querySelector("#save-settings").disabled,
  );
  assert(
    (await page.evaluate(() => sessionStorage.getItem("ark-ui-fixture"))) ===
      null,
    "Blank requirements were saved",
  );
  await requirements.fill(custom);
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    () => sessionStorage.getItem("ark-ui-fixture") !== null,
  );
  await page.reload();
  await page.waitForFunction(
    (custom) =>
      document.querySelector("#classification-requirements")?.value === custom,
    custom,
  );
  assert(
    (await knowledge.inputValue()) === context &&
      (await preview.inputValue()) === finalPrompt,
    "Saved prompt fields did not survive reload",
  );
  assert(
    !(await page.evaluate(
      () =>
        "systemPrompt" in JSON.parse(sessionStorage.getItem("ark-ui-fixture")),
    )),
    "Legacy storage key survived migration",
  );
  await knowledge.fill("");
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    () => JSON.parse(sessionStorage.getItem("ark-ui-fixture")).knowledge === "",
  );
  await page.reload();
  await page.waitForFunction(
    (custom) =>
      document.querySelector("#classification-requirements")?.value === custom,
    custom,
  );
  assert(
    (await knowledge.inputValue()) === "" &&
      !(await preview.inputValue()).includes(context),
    "Cleared Knowledge reappeared",
  );
  await knowledge.fill(context);
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    (context) =>
      JSON.parse(sessionStorage.getItem("ark-ui-fixture")).knowledge ===
      context,
    context,
  );
  const captures = [];
  for (const [locale, width] of [
    ["en", 900],
    ["zh_CN", 375],
    ["en", 320],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/options.html?uiLocale=${locale}`);
    await page.waitForFunction(
      (custom) =>
        document.querySelector("#classification-requirements")?.value ===
        custom,
      custom,
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${locale}/${width}: horizontal overflow`,
    );
    assert(
      (await page.locator('label[for="knowledge"]').innerText()) ===
        messages[locale].knowledge.message,
      "Knowledge label not localised",
    );
    const targets = await page
      .locator("#copy-prompt, #reset-prompt, #save-settings")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      );
    assert(
      targets.every(({ width, height }) => width >= 44 && height >= 44),
      "A prompt action is smaller than 44px",
    );
    await preview.focus();
    await page.keyboard.press("Shift+Tab");
    assert(
      await page.evaluate(() => document.activeElement?.id === "copy-prompt"),
      "Keyboard did not reach the copy action",
    );
    assert(
      await page
        .locator("#copy-prompt")
        .evaluate((button) => getComputedStyle(button).outlineStyle !== "none"),
      "Keyboard focus is not visible",
    );
    // Viewport captures avoid full-page stitching artifacts in attached Chrome.
    for (const [id, section] of [
      ["classification-requirements", "editors"],
      ["system-prompt", "preview"],
    ]) {
      await page.locator(`#${id}`).evaluate((element) => {
        element.scrollTop = 0;
        window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 60);
      });
      const path = `.playwright-mcp/options-knowledge-${locale}-${width}-${section}.png`;
      await page.screenshot({ path, fullPage: false });
      captures.push(path);
    }
  }
  assert(networkCalls === 0, "UI check attempted an external request");
  return {
    passed: true,
    captures,
    checks:
      "migration, live preview, shared drafts, copy/error, restore, validation, save/reload/clear, EN/ZH, keyboard, 44px targets, 320px overflow",
  };
}
