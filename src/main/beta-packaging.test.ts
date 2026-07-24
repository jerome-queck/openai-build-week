// @vitest-environment node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("macOS beta release contract", () => {
  it("declares the source-available license and packages legal notices", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    const packageLock = JSON.parse(await readFile(join(process.cwd(), "package-lock.json"), "utf8"));
    const license = await readFile(join(process.cwd(), "LICENSE"));
    const notice = await readFile(join(process.cwd(), "NOTICE"), "utf8");
    const thirdPartyNotices = await readFile(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");
    const forgeConfig = require(join(process.cwd(), "forge.config.js"));

    expect(packageJson.license).toBe("PolyForm-Noncommercial-1.0.0");
    expect(packageLock.packages[""].license).toBe("PolyForm-Noncommercial-1.0.0");
    expect(packageJson.private).toBe(true);
    expect(createHash("sha256").update(license).digest("hex")).toBe(
      "ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8",
    );
    expect(notice).toContain("Required Notice: Copyright © 2026 Jerome Queck");
    expect(notice).toContain("Clarifold");
    expect(thirdPartyNotices).toContain("Electron 43.1.1");
    expect(thirdPartyNotices).toContain("Lean toolchain");
    expect(thirdPartyNotices).toContain("scheduler");
    expect(forgeConfig.packagerConfig.extraResource).toEqual(expect.arrayContaining([
      "LICENSE",
      "NOTICE",
      "THIRD_PARTY_NOTICES.md",
    ]));
  });

  it("makes a versioned zip and validates an installed copy in the smoke lane", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    const forgeConfig = require(join(process.cwd(), "forge.config.js"));

    expect(forgeConfig.packagerConfig).toMatchObject({
      appBundleId: "com.jeromequeck.quick-study",
      appCategoryType: "public.app-category.education"
    });
    expect(forgeConfig.makers).toEqual([
      expect.objectContaining({ name: "@electron-forge/maker-zip" })
    ]);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
      pattern.test("/node_modules/.cache/quick-study-lean/archive.zip"))).toBe(true);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
      pattern.test("/out/Quick Study-darwin-arm64/Quick Study.app"))).toBe(true);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
      pattern.test("/test-results/installed-beta/Quick Study.app"))).toBe(true);
    expect(packageJson.scripts["make:beta"]).toBe(
      "electron-forge make --platform=darwin --skip-package"
    );
    expect(packageJson.scripts["test:smoke"]).toContain("install-beta-for-smoke.mjs");
    expect(packageJson.scripts["verify:prepackage"]).toContain("npm run policy:documentation");
    expect(packageJson.scripts["verify:package"]).toContain("npm run make:beta && npm run test:smoke");
    expect(packageJson.scripts.verify).toBe("npm run verify:prepackage && npm run verify:package");
  });
});
