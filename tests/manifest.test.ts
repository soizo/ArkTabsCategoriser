import { expect, it } from "vitest";
import config from "../wxt.config";

it.each(["chrome", "firefox"])(
  "builds a compatible %s manifest without granting provider origins",
  async (browser) => {
    expect(config.manifestVersion).toBe(3);
    const manifest =
      typeof config.manifest === "function"
        ? await config.manifest({
            browser,
            manifestVersion: 3,
            command: "build",
            mode: "production",
          })
        : await config.manifest;
    expect(manifest?.permissions).toEqual(["storage", "tabs", "tabGroups"]);
    expect(manifest?.host_permissions).toBeUndefined();
    expect(manifest?.optional_host_permissions).toEqual([
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ]);
    if (browser === "firefox") {
      expect(manifest?.browser_specific_settings).toEqual({
        gecko: {
          id: "ark-tabs-categoriser@ark",
          strict_min_version: "140.0",
          data_collection_permissions: {
            required: ["authenticationInfo", "browsingActivity"],
          },
        },
      });
    } else {
      expect(manifest?.browser_specific_settings).toBeUndefined();
    }
  },
);
