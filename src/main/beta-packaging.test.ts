// @vitest-environment node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

// @ts-expect-error The audit helper is an executable-side JavaScript module.
import { auditPackagedApplication } from "../../scripts/audit-packaged-licenses.mjs";

const require = createRequire(import.meta.url);
const { createPackage } = require("@electron/asar") as {
  createPackage: (source: string, destination: string) => Promise<void>;
};

describe("macOS beta release contract", () => {
  it("declares the source-available license and packages legal notices", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    const packageLock = JSON.parse(await readFile(join(process.cwd(), "package-lock.json"), "utf8"));
    const license = await readFile(join(process.cwd(), "LICENSE.md"));
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
    expect(notice).toContain("sole current copyright owner");
    expect(notice).toContain("name, icon, logo, and product identity are reserved");
    expect(notice).toContain("Clarifold");
    expect(thirdPartyNotices).toContain("Electron 43.1.1");
    expect(thirdPartyNotices).toContain("Lean toolchain");
    expect(thirdPartyNotices).toContain("scheduler");
    expect(forgeConfig.packagerConfig.extraResource).toEqual(expect.arrayContaining([
      "LICENSE.md",
      "NOTICE",
      "THIRD_PARTY_NOTICES.md",
    ]));
    expect(forgeConfig.packagerConfig.beforeCopyExtraResources).toEqual([expect.any(Function)]);
  });

  it("passes the packaged license audit for the allowed runtime graph", async () => {
    const fixture = await createPackagedLicenseFixture();
    try {
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).resolves.toMatchObject({
        runtimePackages: [
          { name: "react", version: "19.2.7", license: "MIT" },
          { name: "react-dom", version: "19.2.7", license: "MIT" },
          { name: "scheduler", version: "0.27.0", license: "MIT" },
        ],
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a packaged artifact with missing notice attribution", async () => {
    const fixture = await createPackagedLicenseFixture();
    try {
      await writeFile(
        join(fixture.applicationPath, "Contents", "Resources", "THIRD_PARTY_NOTICES.md"),
        "Electron 43.1.1\nChromium\nReact\nReact DOM\nLean toolchain\nmathlib\nnative helpers\nsource-bookmark-helper\nsource-index-extractor\n",
      );
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).rejects.toThrow(/notice inventory/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a packaged artifact without native-helper provenance", async () => {
    const fixture = await createPackagedLicenseFixture();
    try {
      const noticesPath = join(fixture.applicationPath, "Contents", "Resources", "THIRD_PARTY_NOTICES.md");
      const notices = await readFile(noticesPath, "utf8");
      await writeFile(noticesPath, notices.split("\n")
        .filter((line) => !line.includes("source-bookmark-helper") && !line.includes("source-index-extractor"))
        .join("\n"));
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).rejects.toThrow(/notice inventory/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a packaged artifact with a runtime version mismatch", async () => {
    const fixture = await createPackagedLicenseFixture({ packagedVersionOverrides: { react: "19.2.6" } });
    try {
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).rejects.toThrow(/runtime version mismatch/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects truncated upstream notices", async () => {
    const fixture = await createPackagedLicenseFixture();
    try {
      await writeFile(join(fixture.applicationPath, "Contents", "Resources", "CHROMIUM_LICENSES.html"), "Chromium\n");
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).rejects.toThrow(/Chromium notices do not match/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects an unresolved or disallowed runtime license", async () => {
    const fixture = await createPackagedLicenseFixture({ runtimeLicense: "GPL-3.0-only" });
    try {
      await expect(auditPackagedApplication(fixture.applicationPath, fixture.auditOptions)).rejects.toThrow(/Disallowed or unknown runtime license/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("makes a versioned zip and validates an installed copy in the smoke lane", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    const forgeConfig = require(join(process.cwd(), "forge.config.js"));

    expect(forgeConfig.packagerConfig).toMatchObject({
      appBundleId: "org.jeromegroup.clarifold",
      appCategoryType: "public.app-category.education"
    });
    expect(forgeConfig.makers).toEqual([
      expect.objectContaining({ name: "@electron-forge/maker-zip" })
    ]);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
    pattern.test("/node_modules/.cache/clarifold-lean/archive.zip"))).toBe(true);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
    pattern.test("/out/Clarifold-darwin-arm64/Clarifold.app"))).toBe(true);
    expect(forgeConfig.packagerConfig.ignore.some((pattern: RegExp) =>
    pattern.test("/test-results/installed-beta/Clarifold.app"))).toBe(true);
    expect(packageJson.scripts["make:beta"]).toBe(
      "electron-forge make --platform=darwin --skip-package"
    );
    expect(packageJson.scripts["test:smoke"]).toContain("install-beta-for-smoke.mjs");
    expect(packageJson.scripts["license:audit"]).toBe("node scripts/audit-packaged-licenses.mjs");
    expect(packageJson.scripts["verify:prepackage"]).toContain("npm run policy:documentation");
    expect(packageJson.scripts["verify:package"]).toContain("npm run make:beta && npm run license:audit && npm run test:smoke");
    expect(packageJson.scripts.verify).toBe("npm run verify:prepackage && npm run verify:package");
  });
});

async function createPackagedLicenseFixture({ runtimeLicense = "MIT", packagedVersionOverrides = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "clarifold-license-audit-"));
  const applicationPath = join(root, "Clarifold.app");
  const resources = join(applicationPath, "Contents", "Resources");
  const verifierId = "test-verifier";
  const verifier = join(resources, "verifiers", verifierId);
  const appSource = join(root, "app-source");
  const packageLock = {
    packages: {
      "": { dependencies: { react: "19.2.7", "react-dom": "19.2.7" } },
      "node_modules/react": { version: "19.2.7", license: runtimeLicense },
      "node_modules/react-dom": { version: "19.2.7", license: runtimeLicense, dependencies: { scheduler: "0.27.0" } },
      "node_modules/scheduler": { version: "0.27.0", license: runtimeLicense },
    },
  };
  await mkdir(join(resources, "app.asar.unpacked", "dist", "helpers"), { recursive: true });
  await mkdir(verifier, { recursive: true });
  await mkdir(join(appSource, "node_modules", "react"), { recursive: true });
  await mkdir(join(appSource, "node_modules", "react-dom"), { recursive: true });
  await mkdir(join(appSource, "node_modules", "scheduler"), { recursive: true });
  await writeFile(join(resources, "LICENSE.md"), await readFile(join(process.cwd(), "LICENSE.md")));
  await writeFile(join(resources, "NOTICE"), await readFile(join(process.cwd(), "NOTICE")));
  await writeFile(join(resources, "THIRD_PARTY_NOTICES.md"), await readFile(join(process.cwd(), "THIRD_PARTY_NOTICES.md")));
  const electronLicense = Buffer.from("Copyright (c) Electron contributors\n");
  const chromiumLicenses = Buffer.from("<title>Chromium licenses</title>\n");
  await writeFile(join(resources, "ELECTRON_LICENSE"), electronLicense);
  await writeFile(join(resources, "CHROMIUM_LICENSES.html"), chromiumLicenses);
  await writeFile(join(verifier, "LICENSE"), "Apache License Version 2.0\n");
  await writeFile(join(verifier, "LICENSES"), "Apache License Version 2.0\n");
  await writeFile(join(verifier, "mathlib-LICENSE"), "Apache License Version 2.0\n");
  await writeFile(join(resources, "app.asar.unpacked", "dist", "helpers", "source-bookmark-helper"), "helper\n");
  await writeFile(join(resources, "app.asar.unpacked", "dist", "helpers", "source-index-extractor"), "helper\n");
  const versions = { react: "19.2.7", "react-dom": "19.2.7", scheduler: "0.27.0" };
  for (const name of ["react", "react-dom", "scheduler"]) {
    await writeFile(join(appSource, "node_modules", name, "package.json"), JSON.stringify({
      name,
      version: packagedVersionOverrides[name] ?? versions[name],
      license: runtimeLicense,
    }));
  }
  await createPackage(appSource, join(resources, "app.asar"));
  return {
    root,
    applicationPath,
    auditOptions: {
      packageLock,
      verifierId,
      expectedDigests: {
        electronLicense: createHash("sha256").update(electronLicense).digest("hex"),
        chromiumLicenses: createHash("sha256").update(chromiumLicenses).digest("hex"),
      },
    },
  };
}
