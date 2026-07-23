import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertRealFile } from "./release-integrity.mjs";

const root = process.cwd();
const modelPath = requiredEvidencePath("QUICK_STUDY_MODEL_EVIDENCE");
const verdictPath = requiredEvidencePath("QUICK_STUDY_EVALUATOR_VERDICTS");
const recoveryPath = requiredEvidencePath("QUICK_STUDY_RECOVERY_EVIDENCE");
const candidateCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (execFileSync("/usr/bin/git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
  throw new Error("Publishing beta release evidence requires a clean, committed candidate worktree.");
}

const packageJson = await json(join(root, "package.json"));
const reportDirectory = join(root, "test-results", "release-quality-gate");
const reportBase = `macos-beta-${packageJson.version}`;
const sources = [
  [join(reportDirectory, `${reportBase}.md`), "quality-gate.md"],
  [join(reportDirectory, `${reportBase}.json`), "quality-gate.json"],
  [join(reportDirectory, "evidence.json"), "release-evidence.json"],
  [join(root, "test-results", "beta-install.json"), "beta-install.json"],
  [modelPath, basename(modelPath)],
  [verdictPath, "blinded-verdicts.json"],
  [recoveryPath, "recovery-verdicts.json"],
  [join(dirname(recoveryPath), "recovery-vitest.json"), "recovery-vitest.json"]
];
const [report, evidence, beta, model, verdicts, recovery] = await Promise.all([
  json(sources[1][0]), json(sources[2][0]), json(sources[3][0]),
  json(modelPath), json(verdictPath), json(recoveryPath)
]);
if (basename(beta.artifact ?? "") !== beta.artifact || !beta.architecture
  || !/^[a-f0-9]{64}$/.test(beta.sha256 ?? "")
  || !/^(arm64|x64)$/.test(beta.architecture)) {
  throw new Error("The distributable beta archive metadata is invalid.");
}
const betaArchivePath = join(root, "out", "make", "zip", "darwin", beta.architecture, beta.artifact);
await assertRealFile(betaArchivePath, "distributable beta archive");
if (await fileDigest(betaArchivePath) !== beta.sha256) {
  throw new Error("The distributable beta archive is missing or does not match the installed candidate digest.");
}
if (report.decision !== "pass") throw new Error("Only a passing candidate quality report can be published.");
if ([report.release?.commit, evidence.release?.commit, beta.candidateCommit,
  model.provenance?.candidateCommit, verdicts.candidateCommit, recovery.candidateCommit]
  .some((commit) => commit !== candidateCommit)) {
  throw new Error("Every published beta report and evidence record must target the exact current commit.");
}
const selectedInputAssets = [
  ["installed-beta", sources[3][0]],
  ["model-responses", modelPath],
  ["blinded-verdicts", verdictPath],
  ["recovery-verdicts", recoveryPath],
  ["recovery-vitest", join(dirname(recoveryPath), "recovery-vitest.json")],
  ["recovery-policy", join(root, "evaluation", "benchmarks", "v2", "recovery-evidence.json")]
];
if (!Array.isArray(evidence.provenance?.inputAssets)
  || evidence.provenance.inputAssets.length !== selectedInputAssets.length) {
  throw new Error("The passing candidate evidence lacks its complete input-asset digest manifest.");
}
for (const [role, path] of selectedInputAssets) {
  await assertRealFile(path, `${role} evidence`);
  const recorded = evidence.provenance.inputAssets.find((asset) => asset.role === role);
  if (!recorded || recorded.name !== basename(path) || recorded.sha256 !== await fileDigest(path)) {
    throw new Error(`Selected ${role} evidence is not the exact input used by the passing candidate gate.`);
  }
}

const outputDirectory = join(root, "out", "release", reportBase);
await mkdir(join(root, "out", "release"), { recursive: true });
await mkdir(outputDirectory, { recursive: false });
const files = [];
for (const [source, destinationName] of sources) {
  const content = await readFile(source);
  await copyFile(source, join(outputDirectory, destinationName));
  files.push({ name: destinationName, sha256: createHash("sha256").update(content).digest("hex") });
}
const manifest = {
  schemaVersion: 1,
  release: report.release,
  decision: report.decision,
  benchmarkVersion: report.benchmarkVersion,
  publishedAt: new Date().toISOString(),
  files,
  distributable: { name: beta.artifact, sha256: beta.sha256 }
};
await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Bundled candidate quality report at ${outputDirectory}.\n`);

function requiredEvidencePath(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to the exact candidate evidence path.`);
  return value;
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
