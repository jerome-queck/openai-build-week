export type BenchmarkSuite = "mathematics" | "failure-recovery";

export interface QualityBenchmark {
  benchmarkVersion: string;
  minimumStochasticRepetitions: number;
  thresholds: {
    minimumScenarioPassRate: number;
    maximumScenarioVariance: number;
  };
  releaseBlockers: string[];
  operationalBudgets: Array<{
    id: string;
    unit: string;
    maximum: number;
  }>;
  scenarios: Array<{
    id: string;
    suite: BenchmarkSuite;
    kind: "deterministic" | "stochastic";
    description: string;
    fixture?: string;
    successCriteria?: string[];
  }>;
}

export interface QualityEvidence {
  benchmarkVersion: string;
  release: { id: string; commit: string };
  provenance: {
    benchmarkCorpus: RevisionPin;
    promptSet: RevisionPin;
    evaluationPolicy: RevisionPin;
    tools: Array<{ name: string; version: string }>;
    sourceRevisions: Array<RevisionPin & { id: string }>;
    verifierEnvironmentManifest: { id: string; sha256: string };
  };
  recordedAt: string;
  versions: {
    application: string;
    modelRuntime: string;
    verifier: string;
  };
  environment: {
    hardware: string;
    operatingSystem: string;
    node: string;
    electron: string;
  };
  trials: Array<{
    scenarioId: string;
    run: number;
    passed: boolean;
    observedBlockers: string[];
    notes?: string;
  }>;
  operationalMeasurements: Array<{
    budgetId: string;
    value: number;
  }>;
  allowedExceptions: Array<{
    id: string;
    rationale: string;
    approvedBy: string;
    expiresOn: string;
  }>;
  knownLimitations: string[];
  productLearningObservations: string[];
  causalLearningEvidence: {
    claimSupported: false;
    summary: string;
  };
}

interface RevisionPin {
  revision: string;
  sha256: string;
}

export interface QualityGateReport {
  decision: "pass" | "fail";
  benchmarkVersion: string;
  release: QualityEvidence["release"];
  provenance: QualityEvidence["provenance"];
  recordedAt: string;
  versions: QualityEvidence["versions"];
  environment: QualityEvidence["environment"];
  failures: string[];
  benchmarkReliability: {
    minimumStochasticRepetitions: number;
    thresholds: QualityBenchmark["thresholds"];
    scenarios: Array<{
      scenarioId: string;
      suite: BenchmarkSuite;
      repetitions: number;
      passRate: number;
      variance: number;
      passed: boolean;
    }>;
  };
  operationalBudgets: Array<{
    id: string;
    unit: string;
    maximum: number;
    measured: number | null;
    passed: boolean;
  }>;
  allowedExceptions: QualityEvidence["allowedExceptions"];
  knownLimitations: string[];
  productLearningObservations: string[];
  causalLearningEvidence: QualityEvidence["causalLearningEvidence"];
}

export function parseQualityBenchmark(value: unknown): QualityBenchmark {
  const benchmark = requireRecord(value, "benchmark");
  const thresholds = requireRecord(benchmark.thresholds, "benchmark.thresholds");
  const scenarios = requireArray(benchmark.scenarios, "benchmark.scenarios").map((value, index) => {
    const scenario = requireRecord(value, `benchmark.scenarios[${index}]`);
    const parsedSuite = requireString(scenario.suite, `benchmark.scenarios[${index}].suite`);
    const parsedKind = requireString(scenario.kind, `benchmark.scenarios[${index}].kind`);
    if (parsedSuite !== "mathematics" && parsedSuite !== "failure-recovery") {
      throw new Error(`benchmark.scenarios[${index}].suite is invalid`);
    }
    if (parsedKind !== "deterministic" && parsedKind !== "stochastic") {
      throw new Error(`benchmark.scenarios[${index}].kind is invalid`);
    }
    const suite: BenchmarkSuite = parsedSuite;
    const kind: "deterministic" | "stochastic" = parsedKind;
    const fixture = scenario.fixture === undefined
      ? undefined
      : requireString(scenario.fixture, `benchmark.scenarios[${index}].fixture`);
    const successCriteria = scenario.successCriteria === undefined
      ? undefined
      : requireStringArray(
        scenario.successCriteria,
        `benchmark.scenarios[${index}].successCriteria`
      );
    if (kind === "stochastic" && (!fixture || !successCriteria || successCriteria.length === 0)) {
      throw new Error(
        `benchmark.scenarios[${index}] stochastic scenarios require fixture and successCriteria`
      );
    }
    return {
      id: requireString(scenario.id, `benchmark.scenarios[${index}].id`),
      suite,
      kind,
      description: requireString(scenario.description, `benchmark.scenarios[${index}].description`),
      ...(fixture === undefined ? {} : { fixture }),
      ...(successCriteria === undefined ? {} : { successCriteria })
    };
  });
  const scenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) {
      throw new Error(`benchmark.scenarios contains duplicate id ${scenario.id}`);
    }
    scenarioIds.add(scenario.id);
  }

  const operationalBudgets = requireArray(
    benchmark.operationalBudgets,
    "benchmark.operationalBudgets"
  ).map((value, index) => {
    const budget = requireRecord(value, `benchmark.operationalBudgets[${index}]`);
    return {
      id: requireString(budget.id, `benchmark.operationalBudgets[${index}].id`),
      unit: requireString(budget.unit, `benchmark.operationalBudgets[${index}].unit`),
      maximum: requireNonNegativeNumber(
        budget.maximum,
        `benchmark.operationalBudgets[${index}].maximum`
      )
    };
  });

  return {
    benchmarkVersion: requireString(benchmark.benchmarkVersion, "benchmark.benchmarkVersion"),
    minimumStochasticRepetitions: requirePositiveInteger(
      benchmark.minimumStochasticRepetitions,
      "benchmark.minimumStochasticRepetitions"
    ),
    thresholds: {
      minimumScenarioPassRate: requireProbability(
        thresholds.minimumScenarioPassRate,
        "benchmark.thresholds.minimumScenarioPassRate"
      ),
      maximumScenarioVariance: requireProbability(
        thresholds.maximumScenarioVariance,
        "benchmark.thresholds.maximumScenarioVariance"
      )
    },
    releaseBlockers: requireStringArray(benchmark.releaseBlockers, "benchmark.releaseBlockers"),
    operationalBudgets,
    scenarios
  };
}

export function parseQualityEvidence(value: unknown): QualityEvidence {
  const evidence = requireRecord(value, "evidence");
  const release = requireRecord(evidence.release, "evidence.release");
  const provenance = requireRecord(evidence.provenance, "evidence.provenance");
  const benchmarkCorpus = requireRecord(
    provenance.benchmarkCorpus,
    "evidence.provenance.benchmarkCorpus"
  );
  const promptSet = requireRecord(provenance.promptSet, "evidence.provenance.promptSet");
  const evaluationPolicy = requireRecord(
    provenance.evaluationPolicy,
    "evidence.provenance.evaluationPolicy"
  );
  const verifierManifest = requireRecord(
    provenance.verifierEnvironmentManifest,
    "evidence.provenance.verifierEnvironmentManifest"
  );
  const versions = requireRecord(evidence.versions, "evidence.versions");
  const environment = requireRecord(evidence.environment, "evidence.environment");
  const causal = requireRecord(evidence.causalLearningEvidence, "evidence.causalLearningEvidence");
  const recordedAt = requireString(evidence.recordedAt, "evidence.recordedAt");
  if (!recordedAt.includes("T") || Number.isNaN(Date.parse(recordedAt))) {
    throw new Error("evidence.recordedAt must be an ISO-8601 date-time");
  }
  const claimSupported = requireBoolean(
    causal.claimSupported,
    "evidence.causalLearningEvidence.claimSupported"
  );
  if (claimSupported) {
    throw new Error("automated quality evidence cannot support a causal learning claim");
  }

  return {
    benchmarkVersion: requireString(evidence.benchmarkVersion, "evidence.benchmarkVersion"),
    release: {
      id: requireString(release.id, "evidence.release.id"),
      commit: requireString(release.commit, "evidence.release.commit")
    },
    provenance: {
      benchmarkCorpus: parseRevisionPin(
        benchmarkCorpus,
        "evidence.provenance.benchmarkCorpus"
      ),
      promptSet: parseRevisionPin(promptSet, "evidence.provenance.promptSet"),
      evaluationPolicy: parseRevisionPin(
        evaluationPolicy,
        "evidence.provenance.evaluationPolicy"
      ),
      tools: requireNonEmptyArray(provenance.tools, "evidence.provenance.tools")
        .map((value, index) => {
          const tool = requireRecord(value, `evidence.provenance.tools[${index}]`);
          return {
            name: requireString(tool.name, `evidence.provenance.tools[${index}].name`),
            version: requireString(tool.version, `evidence.provenance.tools[${index}].version`)
          };
        }),
      sourceRevisions: requireNonEmptyArray(
        provenance.sourceRevisions,
        "evidence.provenance.sourceRevisions"
      ).map((value, index) => {
        const source = requireRecord(value, `evidence.provenance.sourceRevisions[${index}]`);
        return {
          id: requireString(source.id, `evidence.provenance.sourceRevisions[${index}].id`),
          ...parseRevisionPin(source, `evidence.provenance.sourceRevisions[${index}]`)
        };
      }),
      verifierEnvironmentManifest: {
        id: requireString(
          verifierManifest.id,
          "evidence.provenance.verifierEnvironmentManifest.id"
        ),
        sha256: requireSha256(
          verifierManifest.sha256,
          "evidence.provenance.verifierEnvironmentManifest.sha256"
        )
      }
    },
    recordedAt,
    versions: {
      application: requireString(versions.application, "evidence.versions.application"),
      modelRuntime: requireString(versions.modelRuntime, "evidence.versions.modelRuntime"),
      verifier: requireString(versions.verifier, "evidence.versions.verifier")
    },
    environment: {
      hardware: requireString(environment.hardware, "evidence.environment.hardware"),
      operatingSystem: requireString(
        environment.operatingSystem,
        "evidence.environment.operatingSystem"
      ),
      node: requireString(environment.node, "evidence.environment.node"),
      electron: requireString(environment.electron, "evidence.environment.electron")
    },
    trials: requireArray(evidence.trials, "evidence.trials").map((value, index) => {
      const trial = requireRecord(value, `evidence.trials[${index}]`);
      const passed = trial.passed;
      if (typeof passed !== "boolean") {
        throw new Error(`evidence.trials[${index}].passed must be a boolean`);
      }
      const notes = trial.notes;
      if (notes !== undefined && (typeof notes !== "string" || notes.trim() === "")) {
        throw new Error(`evidence.trials[${index}].notes must be a non-empty string`);
      }
      return {
        scenarioId: requireString(trial.scenarioId, `evidence.trials[${index}].scenarioId`),
        run: requirePositiveInteger(trial.run, `evidence.trials[${index}].run`),
        passed,
        observedBlockers: requireStringArray(
          trial.observedBlockers,
          `evidence.trials[${index}].observedBlockers`
        ),
        ...(notes === undefined ? {} : { notes })
      };
    }),
    operationalMeasurements: requireArray(
      evidence.operationalMeasurements,
      "evidence.operationalMeasurements"
    ).map((value, index) => {
      const measurement = requireRecord(value, `evidence.operationalMeasurements[${index}]`);
      return {
        budgetId: requireString(
          measurement.budgetId,
          `evidence.operationalMeasurements[${index}].budgetId`
        ),
        value: requireNonNegativeNumber(
          measurement.value,
          `evidence.operationalMeasurements[${index}].value`
        )
      };
    }),
    allowedExceptions: requireArray(
      evidence.allowedExceptions,
      "evidence.allowedExceptions"
    ).map((value, index) => {
      const exception = requireRecord(value, `evidence.allowedExceptions[${index}]`);
      return {
        id: requireString(exception.id, `evidence.allowedExceptions[${index}].id`),
        rationale: requireString(
          exception.rationale,
          `evidence.allowedExceptions[${index}].rationale`
        ),
        approvedBy: requireString(
          exception.approvedBy,
          `evidence.allowedExceptions[${index}].approvedBy`
        ),
        expiresOn: requireString(
          exception.expiresOn,
          `evidence.allowedExceptions[${index}].expiresOn`
        )
      };
    }),
    knownLimitations: requireStringArray(evidence.knownLimitations, "evidence.knownLimitations"),
    productLearningObservations: requireStringArray(
      evidence.productLearningObservations,
      "evidence.productLearningObservations"
    ),
    causalLearningEvidence: {
      claimSupported: false,
      summary: requireString(causal.summary, "evidence.causalLearningEvidence.summary")
    }
  };
}

export function evaluateQualityGate(
  benchmark: QualityBenchmark,
  evidence: QualityEvidence
): QualityGateReport {
  const failures: string[] = [];
  if (benchmark.benchmarkVersion !== evidence.benchmarkVersion) {
    failures.push(
      `Evidence targets benchmark ${evidence.benchmarkVersion}, expected ${benchmark.benchmarkVersion}.`
    );
  }

  for (const trial of evidence.trials) {
    for (const blocker of trial.observedBlockers) {
      if (benchmark.releaseBlockers.includes(blocker)) {
        failures.push(
          `Release blocker ${blocker} observed in ${trial.scenarioId} run ${trial.run}.`
        );
      } else {
        failures.push(
          `Evidence contains unknown release blocker ${blocker} in ${trial.scenarioId} run ${trial.run}.`
        );
      }
    }
  }

  const scenarioIds = new Set(benchmark.scenarios.map((scenario) => scenario.id));
  for (const trial of evidence.trials) {
    if (!scenarioIds.has(trial.scenarioId)) {
      failures.push(`Evidence contains unknown scenario ${trial.scenarioId}.`);
    }
  }
  const budgetIds = new Set(benchmark.operationalBudgets.map((budget) => budget.id));
  for (const measurement of evidence.operationalMeasurements) {
    if (!budgetIds.has(measurement.budgetId)) {
      failures.push(`Evidence contains unknown operational budget ${measurement.budgetId}.`);
    }
  }

  const scenarios = benchmark.scenarios.map((scenario) => {
    const trialsByRun = new Map<number, QualityEvidence["trials"][number]>();
    for (const trial of evidence.trials.filter((trial) => trial.scenarioId === scenario.id)) {
      if (trialsByRun.has(trial.run)) {
        failures.push(`Scenario ${scenario.id} contains duplicate run ${trial.run}.`);
      } else {
        trialsByRun.set(trial.run, trial);
      }
    }
    const trials = [...trialsByRun.values()];
    const passed = trials.filter((trial) => trial.passed).length;
    const passRate = trials.length === 0 ? 0 : passed / trials.length;
    const variance = passRate * (1 - passRate);
    const requiredRuns = scenario.kind === "stochastic"
      ? benchmark.minimumStochasticRepetitions
      : 1;
    if (trials.length < requiredRuns) {
      failures.push(
        `Scenario ${scenario.id} has ${trials.length} runs; ${requiredRuns} are required.`
      );
    }
    if (passRate < benchmark.thresholds.minimumScenarioPassRate) {
      failures.push(
        `Scenario ${scenario.id} pass rate ${(passRate * 100).toFixed(1)}% is below ${(benchmark.thresholds.minimumScenarioPassRate * 100).toFixed(1)}%.`
      );
    }
    if (variance > benchmark.thresholds.maximumScenarioVariance) {
      failures.push(
        `Scenario ${scenario.id} variance ${variance.toFixed(3)} is above ${benchmark.thresholds.maximumScenarioVariance.toFixed(3)}.`
      );
    }
    return {
      scenarioId: scenario.id,
      suite: scenario.suite,
      repetitions: trials.length,
      passRate,
      variance,
      passed: trials.length >= requiredRuns
        && passRate >= benchmark.thresholds.minimumScenarioPassRate
        && variance <= benchmark.thresholds.maximumScenarioVariance
    };
  });

  const operationalBudgets = benchmark.operationalBudgets.map((budget) => {
    const measurements = evidence.operationalMeasurements.filter(
      (candidate) => candidate.budgetId === budget.id
    );
    if (measurements.length > 1) {
      failures.push(`Operational budget ${budget.id} contains duplicate measurements.`);
    }
    const measurement = measurements[0];
    if (!measurement) {
      failures.push(`Operational budget ${budget.id} has no measurement.`);
    } else if (measurement.value > budget.maximum) {
      failures.push(
        `Operational budget ${budget.id} measured ${measurement.value} ${budget.unit}, above ${budget.maximum} ${budget.unit}.`
      );
    }
    return {
      ...budget,
      measured: measurement?.value ?? null,
      passed: measurement !== undefined && measurement.value <= budget.maximum
    };
  });

  return {
    decision: failures.length === 0 ? "pass" : "fail",
    benchmarkVersion: benchmark.benchmarkVersion,
    release: evidence.release,
    provenance: evidence.provenance,
    recordedAt: evidence.recordedAt,
    versions: evidence.versions,
    environment: evidence.environment,
    failures,
    benchmarkReliability: {
      minimumStochasticRepetitions: benchmark.minimumStochasticRepetitions,
      thresholds: benchmark.thresholds,
      scenarios
    },
    operationalBudgets,
    allowedExceptions: evidence.allowedExceptions,
    knownLimitations: evidence.knownLimitations,
    productLearningObservations: evidence.productLearningObservations,
    causalLearningEvidence: evidence.causalLearningEvidence
  };
}

export function renderQualityGateMarkdown(report: QualityGateReport): string {
  const failureLines = report.failures.length === 0
    ? ["- None."]
    : report.failures.map((failure) => `- ${failure}`);
  const exceptionLines = report.allowedExceptions.length === 0
    ? ["- None."]
    : report.allowedExceptions.map((exception) =>
      `- ${exception.id}: ${exception.rationale} Approved by ${exception.approvedBy}; expires ${exception.expiresOn}.`
    );
  const limitationLines = report.knownLimitations.length === 0
    ? ["- None recorded."]
    : report.knownLimitations.map((limitation) => `- ${limitation}`);
  const observationLines = report.productLearningObservations.length === 0
    ? ["- None recorded."]
    : report.productLearningObservations.map((observation) => `- ${observation}`);
  const scenarioLines = report.benchmarkReliability.scenarios.map((scenario) =>
    `| ${scenario.scenarioId} | ${scenario.suite} | ${scenario.repetitions} | ${(scenario.passRate * 100).toFixed(1)}% | ${scenario.variance.toFixed(3)} | ${scenario.passed ? "pass" : "fail"} |`
  );
  const budgetLines = report.operationalBudgets.map((budget) =>
    `| ${budget.id} | ${budget.measured ?? "missing"} ${budget.unit} | <= ${budget.maximum} ${budget.unit} | ${budget.passed ? "pass" : "fail"} |`
  );

  return [
    `# Quality Gate Report: ${report.release.id}`,
    "",
    `**Decision:** ${report.decision.toUpperCase()}`,
    `**Commit:** ${report.release.commit}`,
    `**Recorded:** ${report.recordedAt}`,
    `**Benchmark:** ${report.benchmarkVersion}`,
    "",
    "## Versions",
    "",
    `- Application: ${report.versions.application}`,
    `- Model Runtime: ${report.versions.modelRuntime}`,
    `- Verifier: ${report.versions.verifier}`,
    `- Environment: ${report.environment.hardware} · ${report.environment.operatingSystem} · ${report.environment.node} · ${report.environment.electron}`,
    "",
    "## Pinned provenance",
    "",
    `- Corpus: ${report.provenance.benchmarkCorpus.revision} (\`${report.provenance.benchmarkCorpus.sha256}\`)`,
    `- Prompt set: ${report.provenance.promptSet.revision} (\`${report.provenance.promptSet.sha256}\`)`,
    `- Evaluation policy: ${report.provenance.evaluationPolicy.revision} (\`${report.provenance.evaluationPolicy.sha256}\`)`,
    `- Tools: ${report.provenance.tools.map((tool) => `${tool.name}@${tool.version}`).join(", ")}`,
    `- Source revisions: ${report.provenance.sourceRevisions.map((source) => `${source.id}@${source.revision} (\`${source.sha256}\`)`).join(", ")}`,
    `- Verifier environment manifest: ${report.provenance.verifierEnvironmentManifest.id} (\`${report.provenance.verifierEnvironmentManifest.sha256}\`)`,
    "",
    "## Benchmark reliability",
    "",
    `- Minimum stochastic repetitions: ${report.benchmarkReliability.minimumStochasticRepetitions}`,
    `- Minimum scenario pass rate: ${(report.benchmarkReliability.thresholds.minimumScenarioPassRate * 100).toFixed(1)}%`,
    `- Maximum scenario variance: ${report.benchmarkReliability.thresholds.maximumScenarioVariance.toFixed(3)}`,
    "",
    "| Scenario | Suite | Runs | Pass rate | Variance | Result |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...scenarioLines,
    "",
    "## Operational budgets",
    "",
    "| Metric | Measured | Threshold | Result |",
    "| --- | ---: | ---: | --- |",
    ...budgetLines,
    "",
    "## Failures",
    "",
    ...failureLines,
    "",
    "## Allowed exceptions",
    "",
    ...exceptionLines,
    "",
    "## Known limitations",
    "",
    ...limitationLines,
    "",
    "## Product-learning observations",
    "",
    ...observationLines,
    "",
    "## Causal educational impact",
    "",
    `Causal educational impact: ${report.causalLearningEvidence.claimSupported ? "supported" : "not supported"}.`,
    "",
    report.causalLearningEvidence.summary,
    ""
  ].join("\n");
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function requireNonEmptyArray(value: unknown, path: string): unknown[] {
  const array = requireArray(value, path);
  if (array.length === 0) throw new Error(`${path} must not be empty`);
  return array;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function requireNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function requireProbability(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be between 0 and 1`);
  }
  return value;
}

function requireSha256(value: unknown, path: string): string {
  const digest = requireString(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest`);
  }
  return digest;
}

function parseRevisionPin(value: Record<string, unknown>, path: string): RevisionPin {
  return {
    revision: requireString(value.revision, `${path}.revision`),
    sha256: requireSha256(value.sha256, `${path}.sha256`)
  };
}
