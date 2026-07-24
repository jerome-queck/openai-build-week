import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const root = process.cwd();
const modelPath = process.env.CLARIFOLD_MODEL_EVIDENCE;
const verdictPath = process.env.CLARIFOLD_EVALUATOR_VERDICTS;
const recoveryPath = process.env.CLARIFOLD_RECOVERY_EVIDENCE;
if (!modelPath || !verdictPath || !recoveryPath) {
  throw new Error(
    "Set CLARIFOLD_MODEL_EVIDENCE, CLARIFOLD_EVALUATOR_VERDICTS, and CLARIFOLD_RECOVERY_EVIDENCE."
  );
}

const [benchmark, recoveryPolicy, beta, model, verdicts, recovery, packageJson, verifier] = await Promise.all([
  json("evaluation/benchmarks/v2/benchmark.json"),
  json("evaluation/benchmarks/v2/recovery-evidence.json"),
  json("test-results/beta-install.json"),
  json(modelPath),
  json(verdictPath),
  json(recoveryPath),
  json("package.json"),
  json("src/shared/bundled-verifier-environment.json")
]);
const candidateCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (execFileSync("/usr/bin/git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
  throw new Error("Release evidence assembly requires a clean candidate worktree.");
}
if (beta.candidateCommit !== candidateCommit || model.provenance?.candidateCommit !== candidateCommit
  || verdicts.candidateCommit !== candidateCommit || recovery.candidateCommit !== candidateCommit) {
  throw new Error("Installed, model, evaluator, and recovery evidence must target the exact current commit.");
}
if (!beta.validations.includes("installed-critical-journeys")
  || !beta.validations.includes("agent-recovery-journeys")
  || !beta.validations.includes("live-codex-authentication-and-teaching")) {
  throw new Error("Installed critical, agent recovery, and live Codex journeys are required.");
}
if (!Array.isArray(verdicts.evaluators) || verdicts.evaluators.length !== 2
  || new Set(verdicts.evaluators.map((evaluator) => evaluator.id)).size !== 2) {
  throw new Error("Exactly two distinct blinded evaluator records are required.");
}
const modelEvidenceSha256 = await fileDigest(modelPath);
if (verdicts.evaluators.some((evaluator) => evaluator.modelEvidenceSha256 !== modelEvidenceSha256)) {
  throw new Error("Every blinded evaluator must be bound to the exact model-evidence SHA-256.");
}
const expectedStochasticKeys = benchmark.scenarios.filter((scenario) => scenario.kind === "stochastic")
  .flatMap((scenario) => Array.from({ length: benchmark.minimumStochasticRepetitions }, (_, index) =>
    `${scenario.id}:${index + 1}`));
for (const evaluator of verdicts.evaluators) {
  const keys = evaluator.trials.map((trial) => `${trial.scenarioId}:${trial.run}`);
  if (keys.length !== expectedStochasticKeys.length
    || expectedStochasticKeys.some((key) => !keys.includes(key))) {
    throw new Error(`Evaluator ${evaluator.id} is missing a stochastic verdict.`);
  }
}
const stochasticTrials = expectedStochasticKeys.map((key) => {
  const [scenarioId, runText] = key.split(":");
  const run = Number(runText);
  const decisions = verdicts.evaluators.map((evaluator) => evaluator.trials.find(
    (trial) => trial.scenarioId === scenarioId && trial.run === run
  ));
  if (decisions.some((decision) => decision.passed !== decisions[0].passed
    || JSON.stringify(decision.observedBlockers) !== JSON.stringify(decisions[0].observedBlockers))) {
    throw new Error(`Blinded evaluator disagreement for ${key} has not been reconciled.`);
  }
  return decisions[0];
});
const expectedDeterministicIds = benchmark.scenarios.filter((scenario) => scenario.kind === "deterministic")
  .map((scenario) => scenario.id);
if (!Array.isArray(recovery.trials) || recovery.trials.length !== expectedDeterministicIds.length
  || expectedDeterministicIds.some((id) => !recovery.trials.some((trial) => trial.scenarioId === id && trial.run === 1))) {
  throw new Error("Candidate-bound deterministic evidence is required for every recovery scenario.");
}
const recoveryPolicyPath = "evaluation/benchmarks/v2/recovery-evidence.json";
if (recovery.recoveryPolicySha256 !== await fileDigest(recoveryPolicyPath)
  || typeof recovery.rawVitestFile !== "string" || basename(recovery.rawVitestFile) !== recovery.rawVitestFile) {
  throw new Error("Recovery evidence must bind the checked-in policy and a sibling raw Vitest report.");
}
const rawVitestPath = join(dirname(recoveryPath), recovery.rawVitestFile);
if (recovery.rawVitestSha256 !== await fileDigest(rawVitestPath)) {
  throw new Error("Recovery evidence does not match its retained raw Vitest report.");
}
const rawVitest = await json(rawVitestPath);
if (rawVitest.success !== true || !Array.isArray(rawVitest.testResults)) {
  throw new Error("The retained raw deterministic recovery suite did not pass.");
}
const rawAssertions = new Map(rawVitest.testResults.flatMap((result) => result.assertionResults)
  .map((assertion) => [assertion.title, assertion]));
const deterministicTrials = recovery.trials.map((trial) => {
  const initial = trial.initialFailureEvidence;
  const policy = recoveryPolicy.scenarios.find((scenario) => scenario.scenarioId === trial.scenarioId);
  const rawInitial = rawAssertions.get(policy?.initialCondition.evidenceTitle);
  if (!policy || !initial || initial.kind !== policy.initialCondition.kind
    || initial.title !== policy.initialCondition.evidenceTitle || initial.status !== "passed"
    || !Number.isFinite(initial.durationMs) || initial.durationMs < 0 || !rawInitial
    || rawInitial.status !== initial.status || rawInitial.duration !== initial.durationMs
    || !Array.isArray(trial.testEvidence) || trial.testEvidence.length !== policy.testTitles.length
    || policy.testTitles.some((title) => {
      const evidence = trial.testEvidence.find((test) => test.title === title);
      const assertion = rawAssertions.get(title);
      return !evidence || !assertion || evidence.status !== assertion.status || evidence.durationMs !== assertion.duration;
    })) {
    throw new Error(`Recovery trial ${trial.scenarioId} lacks explicit initial-failure test evidence.`);
  }
  return {
    scenarioId: trial.scenarioId,
    run: trial.run,
    passed: trial.passed,
    observedBlockers: trial.observedBlockers
  };
});
const modelResponseKeys = model.responses.map((response) => `${response.scenarioId}:${response.run}`);
if (modelResponseKeys.length !== expectedStochasticKeys.length
  || new Set(modelResponseKeys).size !== expectedStochasticKeys.length
  || expectedStochasticKeys.some((key) => !modelResponseKeys.includes(key))
  || model.responses.some((response) => !response.error && !response.content.trim())) {
  throw new Error("Every stochastic teaching key must record either useful content or an explicit failed outcome.");
}
const teachingDurations = model.responses.map((response) => response.durationMs);
const agentLatencySamples = beta.operationalMeasurements.agentLatencySamples;
const realAgentLatencySamples = model.agentResponses.map((response) => response.durationMs);
const expectedAgentRuns = Array.from({ length: benchmark.minimumStochasticRepetitions }, (_, index) => index + 1);
const agentRuns = model.agentResponses.map((response) => response.run);
if (agentRuns.length !== expectedAgentRuns.length || new Set(agentRuns).size !== expectedAgentRuns.length
  || expectedAgentRuns.some((run) => !agentRuns.includes(run))
  || model.agentResponses.some((response) => response.error || !response.content.trim()
    || !Number.isFinite(response.durationMs) || response.durationMs < 0)
  || !model.costReceipt) {
  throw new Error("Successful real-agent latency and metered model/tool cost evidence are required.");
}
const requiredAgentOutcomes = ["checkpointed", "completed", "cancelled", "failed"];
if (!Array.isArray(agentLatencySamples) || agentLatencySamples.length < 5
  || agentLatencySamples.some((sample) => !sample || !requiredAgentOutcomes.includes(sample.outcome)
    || !Number.isFinite(sample.durationMs) || sample.durationMs < 0)
  || requiredAgentOutcomes.some((outcome) => !agentLatencySamples.some((sample) => sample.outcome === outcome))) {
  throw new Error("Candidate-bound Agent Task latency samples must span checkpointed, completed, cancelled, and failed outcomes.");
}
const verifierManifestPath = join("dist", "verifiers", verifier.id, "manifest.json");
const corpusFiles = benchmark.scenarios.filter((scenario) => scenario.fixture).map((scenario) => scenario.fixture);
const evidence = {
  benchmarkVersion: benchmark.benchmarkVersion,
  release: { id: `macos-beta-${packageJson.version}`, commit: candidateCommit },
  provenance: {
    inputAssets: [
      { role: "installed-beta", name: "beta-install.json", sha256: await fileDigest("test-results/beta-install.json") },
      { role: "model-responses", name: basename(modelPath), sha256: await fileDigest(modelPath) },
      { role: "blinded-verdicts", name: basename(verdictPath), sha256: await fileDigest(verdictPath) },
      { role: "recovery-verdicts", name: basename(recoveryPath), sha256: await fileDigest(recoveryPath) },
      { role: "recovery-vitest", name: basename(rawVitestPath), sha256: await fileDigest(rawVitestPath) },
      { role: "recovery-policy", name: basename(recoveryPolicyPath), sha256: await fileDigest(recoveryPolicyPath) }
    ],
    benchmarkCorpus: {
      revision: benchmark.benchmarkVersion,
      sha256: model.provenance.corpusSha256
    },
    promptSet: { revision: `teaching-policy-v${model.runtime.policyVersion}`, sha256: model.provenance.promptPolicySha256 },
    evaluationPolicy: { revision: basename(verdictPath), sha256: await fileDigest(verdictPath) },
    tools: [
      { name: "codex-app-server", version: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim() },
      ...verdicts.evaluators.map((evaluator) => ({ name: evaluator.id, version: evaluator.version }))
    ],
    sourceRevisions: await Promise.all(corpusFiles.map(async (file) => ({
      id: file, revision: benchmark.benchmarkVersion,
      sha256: await fileDigest(join("evaluation", "benchmarks", "v2", file))
    }))),
    verifierEnvironmentManifest: { id: verifier.id, sha256: await fileDigest(verifierManifestPath) }
  },
  recordedAt: new Date().toISOString(),
  versions: {
    application: packageJson.version,
    modelRuntime: `${model.runtime.model}/${model.runtime.reasoningEffort}/policy-v${model.runtime.policyVersion}`,
    verifier: verifier.id
  },
  environment: {
    hardware: beta.testHardware.model,
    operatingSystem: beta.testHardware.operatingSystem,
    node: process.version,
    electron: packageJson.devDependencies.electron
  },
  trials: [...stochasticTrials, ...deterministicTrials],
  operationalMeasurements: [
    { budgetId: "cold-start-p95", value: beta.operationalMeasurements.coldStartP95Ms },
    { budgetId: "peak-memory", value: beta.operationalMeasurements.peakMemoryMiB },
    { budgetId: "source-index-p95", value: beta.operationalMeasurements.sourceIndexP95Ms },
    { budgetId: "verifier-footprint", value: beta.installedDiskMeasurements.verifierFootprintMiB },
    { budgetId: "teaching-latency-p95", value: nearestRankP95(teachingDurations) },
    { budgetId: "agent-latency-p95", value: nearestRankP95([
      ...agentLatencySamples.map((sample) => sample.durationMs), ...realAgentLatencySamples
    ]) },
    { budgetId: "application-disk-use", value: beta.installedDiskMeasurements.applicationDiskUseMiB },
    { budgetId: "metered-model-tool-cost", value: model.costReceipt.meteredModelToolCostUsdPerSession }
  ],
  allowedExceptions: [],
  knownLimitations: [
    "The evaluation archive is ad-hoc signed and not notarized for public internet distribution.",
    "No causal learning-effectiveness claim is supported by this release gate."
  ],
  productLearningObservations: [],
  causalLearningEvidence: {
    claimSupported: false,
    summary: "No randomized or appropriately controlled learning study is represented by this release evidence."
  }
};
const outputDirectory = join(root, "test-results", "release-quality-gate");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function nearestRankP95(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}
