import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { CodexAppServerRuntime } = require(join(process.cwd(), "dist", "main", "codex-app-server.js"));
const benchmark = JSON.parse(await readFile(join(
  process.cwd(), "evaluation", "benchmarks", "v2", "benchmark.json"
), "utf8"));
const outputDirectory = join(process.cwd(), "test-results", "release-evidence");
const requestedModel = process.env.CLARIFOLD_EVALUATION_MODEL ?? "runtimeDefault";
const reasoningEffort = process.env.CLARIFOLD_EVALUATION_REASONING ?? "medium";
const scenarioFilter = process.env.CLARIFOLD_EVALUATION_SCENARIO ?? null;
const policyVersion = 3;
const runtimeDirectory = await mkdtemp(join(tmpdir(), "quick-study-model-evaluation-"));
const candidateCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const worktreeStatus = execFileSync("/usr/bin/git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (worktreeStatus) throw new Error("Release model evidence requires a clean, committed candidate worktree.");
const corpusSha256 = digest(await readFile(join(
  process.cwd(), "evaluation", "benchmarks", "v2", "benchmark.json"
), "utf8") + await Promise.all(benchmark.scenarios.filter((scenario) => scenario.fixture).map(
  (scenario) => readFile(join(process.cwd(), "evaluation", "benchmarks", "v2", scenario.fixture), "utf8")
)).then((parts) => parts.join("\n")));
const promptPolicySha256 = digest(await readFile(join(process.cwd(), "src", "main", "codex-app-server.ts"), "utf8"));
const collectorSha256 = digest(await readFile(new URL(import.meta.url), "utf8"));
const runtime = await CodexAppServerRuntime.launch(runtimeDirectory);

try {
  const authentication = await runtime.getAuthentication();
  if (authentication.status !== "signedIn") {
    throw new Error("The release model evaluation requires a signed-in Codex runtime.");
  }
  const capabilities = await runtime.getCapabilities();
  const selectedModel = requestedModel === "runtimeDefault"
    ? capabilities.models.find((candidate) => candidate.isDefault)
    : capabilities.models.find((candidate) => candidate.model === requestedModel);
  if (!selectedModel || !selectedModel.supportedReasoningEfforts.includes(reasoningEffort)) {
    throw new Error(`The requested release model policy ${requestedModel}/${reasoningEffort} is unavailable.`);
  }
  const model = selectedModel.model;
  const outputPath = join(outputDirectory,
    `model-responses-${model.replaceAll(/[^a-zA-Z0-9.-]/g, "-")}-${reasoningEffort}-v${policyVersion}.json`);
  const scenarios = await Promise.all(benchmark.scenarios
    .filter((scenario) => scenario.kind === "stochastic" && (!scenarioFilter || scenario.id === scenarioFilter))
    .map(async (scenario) => ({
      id: scenario.id,
      prompt: evaluationPrompt(await readFile(join(
        process.cwd(), "evaluation", "benchmarks", "v2", scenario.fixture
      ), "utf8"))
    })));
  await mkdir(outputDirectory, { recursive: true });
  let report = {
    schemaVersion: 1,
    benchmarkVersion: benchmark.benchmarkVersion,
    recordedAt: new Date().toISOString(),
    authenticationMethod: authentication.method,
    runtime: {
      requestedModel,
      model,
      displayName: selectedModel.displayName,
      reasoningEffort,
      policyVersion
    },
    provenance: { candidateCommit, corpusSha256, promptPolicySha256, collectorSha256 },
    agentResponses: [],
    responses: []
  };
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    if (existing.runtime?.model === model && existing.runtime?.reasoningEffort === reasoningEffort
      && existing.runtime?.policyVersion === policyVersion
      && existing.provenance?.candidateCommit === candidateCommit
      && existing.provenance?.corpusSha256 === corpusSha256
      && existing.provenance?.promptPolicySha256 === promptPolicySha256
      && existing.provenance?.collectorSha256 === collectorSha256) report = existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const scenario of scenarios) {
    for (let run = 1; run <= benchmark.minimumStochasticRepetitions; run += 1) {
      if (report.responses.some((response) => response.scenarioId === scenario.id && response.run === run)) continue;
      const sampleRuntime = await CodexAppServerRuntime.launch(runtimeDirectory);
      const startedAt = Date.now();
      let content = "";
      let error = null;
      try {
        await sampleRuntime.streamTeaching({
          sessionId: `release-${scenario.id}-${run}`,
          runtimeSelection: { model, reasoningEffort },
          mathematics: scenario.prompt,
          learningGoal: "Respond accurately to the supplied mathematics without overclaiming.",
          scope: "One bounded Teaching Card",
          initialTeachingDirection: "Address the exact prompt, surface assumptions, and preserve uncertainty or conflicts.",
          accessScope: {
            policy: "focused", sourceIds: [], allowsBroadLocalRead: false, allowsSourceModification: false
          },
          sourceContext: [],
          onAccessRequest: async () => ({ status: "denied", policy: "focused" }),
          onDelta: (delta) => { content += delta; },
          signal: new AbortController().signal
        });
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "Unknown model evaluation failure";
      } finally {
        await sampleRuntime.shutdown();
      }
      report.responses.push({
        scenarioId: scenario.id, run, prompt: scenario.prompt, content,
        durationMs: Date.now() - startedAt, error
      });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`Collected ${scenario.id} run ${run}${error ? ` (failed: ${error})` : ""}.\n`);
    }
  }
  for (let run = 1; run <= benchmark.minimumStochasticRepetitions; run += 1) {
    if (report.agentResponses.some((response) => response.run === run)) continue;
    const sampleRuntime = await CodexAppServerRuntime.launch(runtimeDirectory);
    const startedAt = Date.now();
    let outputTokens = null;
    let content = "";
    let error = null;
    try {
      const result = await sampleRuntime.runSpecialistAgent({
        sessionId: `release-agent-${run}`,
        purpose: "Identify the hidden compactness assumption without overclaiming verification.",
        brief: {
          learningGoal: "Diagnose a compactness proof.", sourceAnchors: [],
          constraints: ["Do not claim formal verification."],
          learnerEvidence: ["The proof infers norm convergence from weak-star compactness."],
          expectedOutput: "One bounded diagnosis.", verificationNeeds: ["Distinguish topologies."]
        },
        budget: {
          agentCount: 1, concurrency: 1, model, reasoningEffort,
          tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
        },
        signal: new AbortController().signal,
        onStatus: () => undefined,
        onPartialResult: () => undefined,
        onTokenUsage: (tokens) => { outputTokens = tokens; }
      });
      content = result.content;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unknown agent evaluation failure";
    } finally {
      await sampleRuntime.shutdown();
    }
    report.agentResponses.push({ run, content, outputTokens, durationMs: Date.now() - startedAt, error });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  report.costReceipt = authentication.method === "chatgpt"
    ? {
        metric: "incremental metered model and paid-tool charges",
        meteredModelToolCostUsdPerSession: 0,
        basis: "The runtime authenticated through an existing ChatGPT subscription, not an API key, and the fixed evaluation policy allowed no paid external tools. These calls therefore created no incremental metered API or tool charge.",
        excludedFixedCost: "The pre-existing ChatGPT subscription fee is a fixed entitlement and is not allocated per session.",
        requestCounts: { teaching: report.responses.length, specialistAgent: report.agentResponses.length },
        providerUsageLimitation: "The ChatGPT subscription runtime does not expose per-call token or dollar receipts for Teaching Card calls.",
        agentOutputTokenUsageObserved: report.agentResponses.map((response) => response.outputTokens)
      }
    : null;
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
} finally {
  await runtime.shutdown();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function evaluationPrompt(markdown) {
  const quoted = markdown.split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2));
  if (quoted.length > 0) return quoted.join("\n");
  const supplied = markdown.split("\n")
    .filter((line) => line.startsWith("- "));
  if (supplied.length > 0) return supplied.join("\n");
  throw new Error("A stochastic corpus item did not contain a supplied prompt.");
}
