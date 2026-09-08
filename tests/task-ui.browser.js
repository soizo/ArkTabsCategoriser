// Run with Playwright MCP browser_run_code_unsafe on a locally served build.
// Fake APIs only; sessionStorage below simulates the separate background, not production persistence.
async function checkTaskUi(page) {
  const base = await page.evaluate(() => location.origin);
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))
    throw new Error("Use a local build, not an extension profile");
  page = await page.context().newPage();
  const messages = {};
  for (const locale of ["en", "zh_CN"])
    messages[locale] = await (
      await page.request.get(`${base}/_locales/${locale}/messages.json`)
    ).json();
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  let external = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("https://**/*", (route) => {
    external++;
    return route.abort();
  });
  await page.addInitScript(
    ({ messages }) => {
      const locale =
        new URL(location.href).searchParams.get("uiLocale") || "en";
      const nativeFetch = window.fetch.bind(window);
      const initial = {
        activeProvider: "openai",
        providers: { openai: { apiKey: "test-key", model: "test-model" } },
      };
      window.mockRequests = [];
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.startsWith(location.origin)) return nativeFetch(input, init);
        window.mockRequests.push(url);
        if (window.mockFailure)
          return new Response(
            JSON.stringify({ error: { message: "Denied" } }),
            { status: 403 },
          );
        if (url.endsWith("/models"))
          return new Response(
            JSON.stringify({
              data: Array.from({ length: 428 }, (_, i) => ({
                id: i ? `model-${i}` : "test-model",
              })),
            }),
          );
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
        );
      };
      let listener;
      let disconnect;
      let task = JSON.parse(sessionStorage.getItem("ui-task") || "null");
      let reasoning = sessionStorage.getItem("ui-reasoning") || "";
      window.publishTask = (phase, text = reasoning) => {
        if (phase) task.phase = phase;
        reasoning = text;
        if (phase === "complete")
          task.result = { groupCount: 1, ungroupedCount: 0 };
        sessionStorage.setItem("ui-task", JSON.stringify(task));
        sessionStorage.setItem("ui-reasoning", reasoning);
        listener?.({ type: "state", task: structuredClone(task), reasoning });
      };
      window.dropTaskConnection = () => disconnect?.();
      window.browser = {
        windows: { getCurrent: async () => ({ id: 7 }) },
        runtime: {
          id: "ark-task-ui-test",
          sendMessage: async (message) => {
            if (message.type === "popupState")
              return {
                ok: true,
                count: 2,
                provider: "openrouter",
                model: "saved-model",
                configuredProviders: [
                  { provider: "openrouter", model: "saved-model" },
                ],
                groups: [],
              };
            if (message.type === "testModel" && window.mockFailure)
              return {
                ok: false,
                errorCode: "forbidden",
                diagnostic: {
                  stage: "response",
                  reason: "http_error",
                  status: 403,
                },
              };
            return { ok: true };
          },
          connect: () => ({
            onMessage: {
              addListener: (callback) => {
                listener = callback;
                queueMicrotask(() =>
                  callback({
                    type: "state",
                    task: structuredClone(task),
                    reasoning,
                  }),
                );
              },
            },
            onDisconnect: {
              addListener: (callback) => {
                disconnect = callback;
              },
            },
            postMessage: (message) => {
              if (message.type === "start") {
                const starts =
                  Number(sessionStorage.getItem("ui-starts") || 0) + 1;
                sessionStorage.setItem("ui-starts", String(starts));
                task = {
                  id: `task-${starts}`,
                  windowId: message.windowId,
                  startedAt: Date.now() - 130_000,
                  phase: "running",
                  info: {
                    count: 2,
                    provider: "openrouter",
                    model: "running-model",
                  },
                };
                window.publishTask("running", "Thinking once. ");
              } else if (
                message.type === "stop" &&
                task?.id === message.id &&
                task.phase === "running"
              ) {
                sessionStorage.setItem(
                  "ui-stops",
                  String(Number(sessionStorage.getItem("ui-stops") || 0) + 1),
                );
                window.publishTask("stopping");
              }
            },
          }),
        },
        i18n: {
          getUILanguage: () => (locale === "zh_CN" ? "zh-CN" : "en"),
          getMessage: (key, values = []) =>
            (messages[locale]?.[key]?.message || key).replace(
              /\$(\d+)/g,
              (_, n) => [].concat(values)[Number(n) - 1] ?? "",
            ),
        },
        permissions: {
          request: async () =>
            window.delayPermission
              ? new Promise((resolve) => {
                  window.resolvePermission = resolve;
                })
              : true,
          contains: async () => true,
        },
        storage: {
          local: {
            get: async () => ({
              arkSettings: JSON.parse(
                sessionStorage.getItem("ui-settings") ||
                  JSON.stringify(initial),
              ),
            }),
            set: async (value) =>
              sessionStorage.setItem(
                "ui-settings",
                JSON.stringify(value.arkSettings),
              ),
          },
        },
      };
    },
    { messages },
  );

  const captures = [];
  for (const [locale, width] of [
    ["en", 900],
    ["zh_CN", 320],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}/options.html?uiLocale=${locale}`);
    await page.waitForFunction(
      () => document.querySelector("#api-key")?.value === "test-key",
    );
    await page.locator("#load-models").click();
    await page.waitForFunction(() =>
      document.querySelector("#model-status")?.textContent.includes("428"),
    );
    assert(
      (await page.locator("#model-feedback #model-status").count()) === 1,
      "Model status is outside model controls",
    );
    assert(
      !(await page.locator("#settings-status").innerText()).includes("428"),
      "Model count leaked to footer",
    );
    const near = await page.evaluate(
      () =>
        document.querySelector("#model-status").getBoundingClientRect().top -
        document.querySelector("#test-model").getBoundingClientRect().bottom,
    );
    assert(near >= 0 && near < 32, "Model feedback is not next to Test model");
    await page.locator("#test-model").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#model-status")?.dataset.kind === "success" &&
        !document.querySelector("#test-model").disabled,
    );
    assert(
      (await page.locator("#model-status").innerText()) ===
        messages[locale].modelTestSucceeded.message,
      "Wrong test feedback",
    );
    await page.evaluate(() => {
      window.mockFailure = true;
    });
    await page.locator("#test-model").click();
    await page.waitForFunction(
      () => document.querySelector("#model-status")?.dataset.kind === "error",
    );
    assert(
      await page.locator("#model-feedback #settings-output").isVisible(),
      "Model diagnostic is not contextual",
    );
    await page.evaluate(() => {
      window.mockFailure = false;
    });
    await page.locator("#save-settings").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#settings-status")?.dataset.kind === "success",
    );
    assert(
      (await page.locator(".form-footer #settings-status").count()) === 1,
      "Save feedback moved away from Save",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Options overflow",
    );
    await page.locator("#load-models").click();
    await page.waitForFunction(() =>
      document.querySelector("#model-status")?.textContent.includes("428"),
    );
    await page
      .locator("#model")
      .evaluate((element) =>
        window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 60),
      );
    const path = `.playwright-mcp/task-options-${locale}-${width}.png`;
    await page.screenshot({ path });
    captures.push(path);
  }
  const before = await page.evaluate(() => window.mockRequests.length);
  await page.evaluate(() => {
    window.delayPermission = true;
  });
  await page.locator("#load-models").click();
  await page
    .locator('.provider-switch label:has(input[value="anthropic"])')
    .click();
  await page.evaluate(() => window.resolvePermission(true));
  await page.waitForFunction(
    () => !document.querySelector("#load-models").disabled,
  );
  assert(
    (await page.evaluate(() => window.mockRequests.length)) === before,
    "Changing provider during permission sent an old key to a new provider",
  );

  for (const locale of ["en", "zh_CN"]) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${base}/popup.html?uiLocale=${locale}`);
    await page.waitForFunction(
      () => !document.querySelector("#organise")?.disabled,
    );
    const starts = Number(
      await page.evaluate(() => sessionStorage.getItem("ui-starts") || 0),
    );
    await page.evaluate(() => {
      window.mockFailure = true;
    });
    await page.locator("#test-model").click();
    await page.waitForFunction(
      () => document.querySelector("#model-status")?.dataset.kind === "error",
    );
    assert(
      await page.locator("#model-control #reasoning-panel").isVisible(),
      "Popup model diagnostic is not next to Test",
    );
    await page.evaluate(() => {
      window.mockFailure = false;
    });
    await page.locator("#organise").click();
    await page.locator("#stop-organise").waitFor({ state: "visible" });
    assert(
      (await page.locator("#active-model option:checked").innerText()).includes(
        "running-model",
      ),
      "Running model was replaced by saved settings",
    );
    assert(
      (await page.locator("#reasoning-content").innerText()).trim() ===
        "Thinking once.",
      "Reasoning was duplicated",
    );
    await page.reload();
    await page.locator("#stop-organise").waitFor({ state: "visible" });
    assert(
      Number(await page.evaluate(() => sessionStorage.getItem("ui-starts"))) ===
        starts + 1,
      "Reopening started a second task",
    );
    assert(
      (await page.locator("#reasoning-content").innerText()).trim() ===
        "Thinking once.",
      "Reopening lost/repeated reasoning",
    );
    assert(
      parseFloat(await page.locator("#reasoning-elapsed").innerText()) >= 130,
      "Elapsed time restarted on reopen",
    );
    await page.evaluate(() => window.dropTaskConnection());
    await page.waitForFunction(
      () => !document.querySelector("#stop-organise").disabled,
    );
    assert(
      Number(await page.evaluate(() => sessionStorage.getItem("ui-starts"))) ===
        starts + 1,
      "Reconnection restarted the task",
    );
    const target = await page.locator("#stop-organise").boundingBox();
    assert(
      target.width >= 44 &&
        target.height >= 44 &&
        target.y + target.height < 600,
      "Stop is too small or below the popup fold",
    );
    await page.locator("#stop-organise").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert(
      await page
        .locator("#stop-organise")
        .evaluate(
          (element) => getComputedStyle(element).outlineStyle !== "none",
        ),
      "Stop has no focus indicator",
    );
    const path = `.playwright-mcp/task-popup-${locale}-360.png`;
    await page.screenshot({ path });
    captures.push(path);
    await page.locator("#stop-organise").click();
    assert(
      await page.locator("#stop-organise").isDisabled(),
      "Stop can be sent repeatedly",
    );
    await page.evaluate(() => window.publishTask("cancelled", ""));
    assert(
      (await page.locator("#popup-status").innerText()) ===
        messages[locale].organiseCancelled.message,
      "Cancellation shown as a timeout",
    );
    await page.locator("#organise").click();
    await page.evaluate(() => window.publishTask("applying"));
    assert(
      await page.locator("#stop-organise").isDisabled(),
      "Commit phase can be interrupted",
    );
    await page.evaluate(() => window.publishTask("complete", ""));
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#popup-status")?.dataset.kind === "success",
    );
    assert(
      await page.locator("#stop-organise").isHidden(),
      "Stop remains after completion",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Popup overflow",
    );
  }
  assert(external === 0, "External request escaped mocks");
  assert(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  return {
    passed: true,
    captures,
    checks:
      "EN/ZH; model load/test/error placement; save placement; permission race; reopen/reconnect without restart; reasoning replay; elapsed time; stop; commit lock; completion replay; focus; 44px; narrow layouts; no external requests",
  };
}
