import { extractFile, listPackage } from "@electron/asar";
import { createHash } from "node:crypto";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LICENSE_SHA256 = "ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8";
const NOTICE_SHA256 = "f813c9234a763c6b2d2ba7d0630baa11eb1161e85dd1e84ea778799171b34d84";
const THIRD_PARTY_NOTICES_SHA256 = "6b0225ece922033d243e1287514f0643a6f88a6561ad150c9d20b182f1526a08";
const ELECTRON_LICENSE_SHA256 = "5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d";
const CHROMIUM_LICENSES_SHA256 = "4fc0507a046b9ecd0738b2dd64119b5ec8bc29ac0221b63edb693fd5fd497c87";
const ALLOWED_NPM_RUNTIME_LICENSES = new Set(["MIT"]);

export async function auditPackagedApplication(applicationPath, options = {}) {
  const expectedDigests = {
    notice: options.expectedDigests?.notice ?? NOTICE_SHA256,
    thirdPartyNotices: options.expectedDigests?.thirdPartyNotices ?? THIRD_PARTY_NOTICES_SHA256,
    electronLicense: options.expectedDigests?.electronLicense ?? ELECTRON_LICENSE_SHA256,
    chromiumLicenses: options.expectedDigests?.chromiumLicenses ?? CHROMIUM_LICENSES_SHA256,
  };
  const packageLock = options.packageLock ?? JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8"));
  const verifierId = options.verifierId ?? JSON.parse(await readFile(
    join(projectRoot, "src", "shared", "bundled-verifier-environment.json"),
    "utf8",
  )).id;
  const contents = join(applicationPath, "Contents");
  const resources = join(contents, "Resources");
  const asarPath = join(resources, "app.asar");
  const verifier = join(resources, "verifiers", verifierId);

  await requireNonEmptyFile(join(resources, "ELECTRON_LICENSE"), "Electron license");
  await requireNonEmptyFile(join(resources, "CHROMIUM_LICENSES.html"), "Chromium notices");
  const projectLicense = await requireNonEmptyFile(join(resources, "LICENSE.md"), "Clarifold license");
  if (sha256(projectLicense) !== LICENSE_SHA256) {
    throw new Error("Packaged Clarifold LICENSE.md does not match PolyForm Noncommercial 1.0.0.");
  }
  const notice = await requireNonEmptyFile(join(resources, "NOTICE"), "Clarifold notice");
  if (sha256(notice) !== expectedDigests.notice) throw new Error("Packaged NOTICE does not match the repository legal notice.");
  if (!notice.includes("Required Notice: Copyright © 2026 Jerome Queck")) {
    throw new Error("Packaged NOTICE is missing the required Jerome Queck copyright notice.");
  }
  const thirdPartyNotices = await requireNonEmptyFile(join(resources, "THIRD_PARTY_NOTICES.md"), "third-party notices");
  if (sha256(thirdPartyNotices) !== expectedDigests.thirdPartyNotices) {
    throw new Error("Packaged third-party notices do not match the repository notice inventory.");
  }
  const normalizedThirdPartyNotices = thirdPartyNotices.toString("utf8").replace(/\s+/g, " ");
  for (const requiredNotice of [
    "Electron 43.1.1",
    "Chromium",
    "React",
    "React DOM",
    "scheduler",
    "Lean toolchain",
    "mathlib",
    "native helpers",
    "source-bookmark-helper",
    "source-index-extractor",
    "are built from the repository's native helpers",
    "remain covered by that same notice",
    "`source-bookmark-helper` | Repository `native/source-bookmark-helper.swift` | PolyForm-Noncommercial-1.0.0",
    "`source-index-extractor` | Repository `native/source-index-extractor.swift` | PolyForm-Noncommercial-1.0.0",
  ]) {
    if (!normalizedThirdPartyNotices.includes(requiredNotice)) {
      throw new Error(`Packaged third-party notices are missing required attribution: ${requiredNotice}`);
    }
  }
  const electronLicense = await requireNonEmptyFile(join(resources, "ELECTRON_LICENSE"), "Electron license");
  if (sha256(electronLicense) !== expectedDigests.electronLicense) throw new Error("Packaged Electron license does not match Electron 43.1.1.");
  const chromiumLicenses = await requireNonEmptyFile(join(resources, "CHROMIUM_LICENSES.html"), "Chromium notices");
  if (sha256(chromiumLicenses) !== expectedDigests.chromiumLicenses) throw new Error("Packaged Chromium notices do not match Electron 43.1.1.");
  await requireLicenseText(join(verifier, "LICENSE"), "Lean license");
  await requireLicenseText(join(verifier, "LICENSES"), "Lean component licenses");
  await requireLicenseText(join(verifier, "mathlib-LICENSE"), "mathlib license");
  await requireNonEmptyFile(join(resources, "app.asar.unpacked", "dist", "helpers", "source-bookmark-helper"), "source bookmark helper");
  await requireNonEmptyFile(join(resources, "app.asar.unpacked", "dist", "helpers", "source-index-extractor"), "source index helper");

  const expectedRuntimePackages = runtimePackages(packageLock);
  const expectedByName = new Map(expectedRuntimePackages.map((entry) => [entry.name, entry]));
  const packagedPackagePaths = listPackage(asarPath)
    .map((path) => path.replace(/^\/+/, ""))
    .filter((path) => /^node_modules\/.+\/package\.json$/.test(path));
  const packagedNames = new Set();
  for (const packageJsonPath of packagedPackagePaths) {
    let packagedPackage;
    try {
      packagedPackage = JSON.parse(extractFile(asarPath, packageJsonPath).toString("utf8"));
    } catch (error) {
      throw new Error(`Packaged runtime dependency metadata is unreadable: ${packageJsonPath}`, { cause: error });
    }
    const expected = expectedByName.get(packagedPackage.name);
    if (!expected) throw new Error(`Unexpected packaged runtime dependency: ${packagedPackage.name ?? packageJsonPath}`);
    packagedNames.add(packagedPackage.name);
    if (!ALLOWED_NPM_RUNTIME_LICENSES.has(expected.license)) {
      throw new Error(`Disallowed or unknown runtime license for ${packagedPackage.name}: ${expected.license}`);
    }
    if (packagedPackage.version !== expected.version) {
      throw new Error(`Packaged runtime version mismatch for ${packagedPackage.name}: expected ${expected.version}, got ${packagedPackage.version ?? "unknown"}`);
    }
    if (packagedPackage.license !== expected.license) {
      throw new Error(`Packaged runtime license mismatch for ${packagedPackage.name}: expected ${expected.license}, got ${packagedPackage.license ?? "unknown"}`);
    }
  }
  for (const expected of expectedRuntimePackages) {
    if (!packagedNames.has(expected.name)) throw new Error(`Packaged runtime dependency is missing: ${expected.name}`);
  }

  return { applicationPath, runtimePackages: expectedRuntimePackages.map(({ name, license, version }) => ({ name, license, version })) };
}

async function requireNonEmptyFile(path, label) {
  try {
    const trustedPath = await realpath(path);
    const contents = await readFile(trustedPath);
    if (contents.length === 0) throw new Error("empty file");
    return contents;
  } catch (error) {
    throw new Error(`Packaged ${label} is missing or unreadable: ${path}`, { cause: error });
  }
}

async function requireLicenseText(path, label) {
  const contents = await requireNonEmptyFile(path, label);
  if (!contents.toString("utf8").includes("Apache License")) {
    throw new Error(`Packaged ${label} has unexpected contents.`);
  }
}

function runtimePackages(packageLock) {
  const packages = packageLock.packages ?? {};
  const queue = Object.keys(packages[""]?.dependencies ?? {}).map((name) => ({ name, parentKey: "" }));
  const visited = new Set();
  const result = [];
  while (queue.length > 0) {
    const { name, parentKey } = queue.shift();
    const packageLockPath = resolvePackageKey(packages, name, parentKey);
    if (!packageLockPath) throw new Error(`Could not resolve package-lock entry for runtime dependency ${name}.`);
    if (visited.has(packageLockPath)) continue;
    visited.add(packageLockPath);
    const metadata = packages[packageLockPath];
    const license = typeof metadata.license === "string" ? metadata.license : "unknown";
    const version = typeof metadata.version === "string" ? metadata.version : "unknown";
    result.push({ name, packageLockPath, license, version });
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      queue.push({ name: dependency, parentKey: packageLockPath });
    }
  }
  return result;
}

function resolvePackageKey(packages, name, parentKey) {
  let current = parentKey;
  while (current) {
    const candidate = `${current}/node_modules/${name}`;
    if (packages[candidate]) return candidate;
    const boundary = current.lastIndexOf("/node_modules/");
    current = boundary < 0 ? "" : current.slice(0, boundary);
  }
  const rootCandidate = `node_modules/${name}`;
  return packages[rootCandidate] ? rootCandidate : null;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function findPackagedApplication() {
  const outDirectory = join(projectRoot, "out");
  const entries = await readdir(outDirectory, { withFileTypes: true });
  const expectedPackageName = `Quick Study-darwin-${process.arch}`;
  const packageDirectory = entries.find((entry) => entry.isDirectory() && entry.name === expectedPackageName);
  if (!packageDirectory) throw new Error(`No packaged Quick Study application found under ${outDirectory}.`);
  return join(outDirectory, packageDirectory.name, "Quick Study.app");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const applicationPath = await findPackagedApplication();
  await access(applicationPath);
  const result = await auditPackagedApplication(applicationPath);
  console.log(`Packaged license audit passed for ${result.applicationPath}: ${result.runtimePackages.map(({ name, license }) => `${name} (${license})`).join(", ")}.`);
}
