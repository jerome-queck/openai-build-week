import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, join, relative } from "node:path";

const projectRoot = process.cwd();
const specification = JSON.parse(await readFile(join(projectRoot, "src", "shared", "bundled-verifier-environment.json"), "utf8"));
if (process.platform !== "darwin" || !(process.arch in specification.releases)) {
  throw new Error(`The bundled verifier supports macOS arm64 and x64; received ${process.platform} ${process.arch}.`);
}

const release = specification.releases[process.arch];
const verifiersDirectory = join(projectRoot, "dist", "verifiers");
const destination = join(verifiersDirectory, specification.id);
const cacheDirectory = join(projectRoot, "node_modules", ".cache", "quick-study-lean");
const archivePath = join(cacheDirectory, release.archive);
const extractionDirectory = join(cacheDirectory, `${specification.id}-${process.arch}-extracted`);
const mathlibSourceDirectory = join(cacheDirectory, `mathlib-source-${specification.mathlibCommit}`);
const mathlibWorkingDirectory = join(cacheDirectory, `.mathlib-work-${process.pid}`);
const staging = join(verifiersDirectory, `.${specification.id}.staging-${process.pid}`);
await mkdir(cacheDirectory, { recursive: true });
await removeAbandonedMathlibWorktrees(cacheDirectory);
if (await preparedRuntimeIsCurrent(destination)) {
  process.exit(0);
}

await mkdir(verifiersDirectory, { recursive: true });
for (const entry of await readdir(verifiersDirectory, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith(`.${specification.id}.staging-`)) {
    await rm(join(verifiersDirectory, entry.name), { recursive: true, force: true });
  }
}

if (!await fileHasDigest(archivePath, release.sha256)) {
  await rm(archivePath, { force: true });
  await run("/usr/bin/curl", ["--fail", "--location", "--retry", "3", "--output", archivePath,
    `https://github.com/leanprover/lean4/releases/download/v${specification.leanVersion}/${release.archive}`]);
  if (!await fileHasDigest(archivePath, release.sha256)) throw new Error("Downloaded Lean archive failed its pinned SHA-256 check.");
}

let extractedNames = [];
try {
  extractedNames = (await readdir(extractionDirectory)).filter((name) => name.startsWith(`lean-${specification.leanVersion}-darwin`));
} catch { /* extracted below */ }
if (extractedNames.length !== 1) {
  await rm(extractionDirectory, { recursive: true, force: true });
  await mkdir(extractionDirectory, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", archivePath, extractionDirectory]);
  extractedNames = (await readdir(extractionDirectory)).filter((name) => name.startsWith(`lean-${specification.leanVersion}-darwin`));
}
if (extractedNames.length !== 1) throw new Error("The pinned Lean archive has an unexpected layout.");
const leanSource = join(extractionDirectory, extractedNames[0]);

if (!await mathlibCheckoutIsCurrent(mathlibSourceDirectory)) {
  await rm(mathlibSourceDirectory, { recursive: true, force: true });
  await run("/usr/bin/git", ["clone", "--depth", "1", "--branch", `v${specification.mathlibVersion}`,
    "https://github.com/leanprover-community/mathlib4.git", mathlibSourceDirectory]);
  const commit = (await run("/usr/bin/git", ["rev-parse", "HEAD"], true, mathlibSourceDirectory)).trim();
  if (commit !== specification.mathlibCommit) throw new Error(`Pinned mathlib tag resolved to unexpected commit ${commit}.`);
}

await rm(mathlibWorkingDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
await run("/usr/bin/git", ["clone", "--shared", "--no-checkout", mathlibSourceDirectory, mathlibWorkingDirectory]);
await run("/usr/bin/git", ["remote", "set-url", "origin", "https://github.com/leanprover-community/mathlib4.git"], false,
  mathlibWorkingDirectory);
await run("/usr/bin/git", ["checkout", "--detach", specification.mathlibCommit], false, mathlibWorkingDirectory);
const lake = join(leanSource, "bin", "lake");
await run(lake, ["exe", "cache", "get", ...specification.mathlibModules], false, mathlibWorkingDirectory);

await rm(staging, { recursive: true, force: true });
await copySelectedLeanRuntime(leanSource, staging);
await copyMathlibSupport(mathlibWorkingDirectory, staging);
await chmod(join(staging, "bin", "lean"), 0o755);
await mkdir(join(staging, "app-support"), { recursive: true });
await writeFile(join(staging, "app-support", "QuickStudyNatAddZero.lean"), proofSource(), "utf8");
await writeFile(join(staging, "manifest.json"), `${JSON.stringify({
  id: specification.id,
  checker: specification.checker,
  leanVersion: specification.leanVersion,
  mathlibVersion: specification.mathlibVersion,
  mathlibCommit: specification.mathlibCommit,
  platform: specification.platform,
  architecture: process.arch,
  sourceArchive: release.archive,
  sourceSha256: release.sha256,
  supportProfile: specification.supportProfile,
  mathlibModules: specification.mathlibModules,
  runtimeFormat: specification.runtimeFormat,
  components: ["Lean toolchain", "mathlib precompiled cache", "Quick Study app support"]
}, null, 2)}\n`, "utf8");

if (!await preparedRuntimeIsCurrent(staging)) {
  throw new Error("Staged Verification Environment failed version, manifest, or real-proof validation.");
}

const backup = `${destination}.superseded-${process.pid}`;
let hadDestination = false;
try {
  await access(destination);
  hadDestination = true;
  await rename(destination, backup);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try {
  await rename(staging, destination);
} catch (error) {
  if (hadDestination) await rename(backup, destination);
  throw error;
}
await rm(backup, { recursive: true, force: true });
await rm(mathlibWorkingDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  .catch((error) => console.warn(`Validated environment activated; temporary mathlib worktree retained at ${mathlibWorkingDirectory} and will be removed by a later build: ${error.message}`));
for (const entry of await readdir(verifiersDirectory, { withFileTypes: true })) {
  if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== specification.id) {
    await rm(join(verifiersDirectory, entry.name), { recursive: true, force: true });
  }
}

async function removeAbandonedMathlibWorktrees(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const match = /^\.mathlib-work-(\d+)$/.exec(entry.name);
    if (!entry.isDirectory() || !match || processIsRunning(Number(match[1]))) continue;
    const path = join(directory, entry.name);
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      .catch((error) => console.warn(`Could not remove abandoned mathlib worktree ${path}; a later build will retry: ${error.message}`));
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function copySelectedLeanRuntime(sourceRoot, destinationRoot) {
  const paths = ["LICENSE", "LICENSES", "bin/lean"];
  const leanLibrary = join(sourceRoot, "lib", "lean");
  for (const entry of await readdir(leanLibrary, { withFileTypes: true })) {
    if (entry.isFile() && /^lib.*shared.*\.dylib$/.test(entry.name)) paths.push(join("lib", "lean", entry.name));
  }
  for (const path of paths) await copyPath(join(sourceRoot, path), join(destinationRoot, path));
  await copyCompiledTree(leanLibrary, leanLibrary, join(destinationRoot, "lib", "lean"));
}

async function copyMathlibSupport(mathlibRoot, destinationRoot) {
  const libraries = [join(mathlibRoot, ".lake", "build", "lib", "lean")];
  const packagesDirectory = join(mathlibRoot, ".lake", "packages");
  for (const entry of await readdir(packagesDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) libraries.push(join(packagesDirectory, entry.name, ".lake", "build", "lib", "lean"));
  }
  for (const library of libraries) {
    try {
      await copyCompiledTree(library, library, join(destinationRoot, "lib", "lean"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await copyPath(join(mathlibRoot, "LICENSE"), join(destinationRoot, "mathlib-LICENSE"));
}

async function copyCompiledTree(directory, libraryRoot, destinationRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await copyCompiledTree(path, libraryRoot, destinationRoot);
    else if ([".olean", ".olean.private", ".olean.server", ".ir"].some((suffix) => entry.name.endsWith(suffix))) {
      await copyPath(path, join(destinationRoot, relative(libraryRoot, path)));
    }
  }
}

async function copyPath(from, to) {
  await mkdir(dirname(to), { recursive: true });
  const sourceStat = await stat(from);
  if (sourceStat.isDirectory()) await mkdir(to, { recursive: true });
  else await copyFile(from, to);
}

async function fileHasDigest(path, expected) {
  try { await access(path); } catch { return false; }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex") === expected;
}

async function mathlibCheckoutIsCurrent(path) {
  try {
    const commitMatches = (await run("/usr/bin/git", ["rev-parse", "HEAD"], true, path)).trim() === specification.mathlibCommit;
    const toolchain = (await readFile(join(path, "lean-toolchain"), "utf8")).trim();
    return commitMatches && toolchain === `leanprover/lean4:v${specification.leanVersion}`;
  } catch { return false; }
}

async function preparedRuntimeIsCurrent(root) {
  try {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    const identityMatches = manifest.id === specification.id
      && manifest.leanVersion === specification.leanVersion
      && manifest.mathlibVersion === specification.mathlibVersion
      && manifest.mathlibCommit === specification.mathlibCommit
      && Array.isArray(manifest.mathlibModules)
      && manifest.mathlibModules.join("\n") === specification.mathlibModules.join("\n")
      && manifest.architecture === process.arch
      && manifest.sourceSha256 === release.sha256
      && manifest.runtimeFormat === specification.runtimeFormat;
    if (!identityMatches) return false;
    const lean = join(root, "bin", "lean");
    const versionOutput = await run(lean, ["--version"], true);
    if (!versionOutput.includes(`version ${specification.leanVersion}`)) return false;
    const validationFile = join(root, "app-support", "QuickStudyNatAddZero.lean");
    await run(lean, [validationFile], true);
    return true;
  } catch { return false; }
}

function proofSource() {
  return "import Mathlib.Data.Nat.Basic\n\ntheorem quickStudyNatAddZero (n : Nat) : n + 0 = n := by\n  simpa using Nat.add_zero n\n";
}

function run(command, args, capture = false, cwd = projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    }
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${basename(command)} exited with ${code}. ${output}`)));
  });
}
