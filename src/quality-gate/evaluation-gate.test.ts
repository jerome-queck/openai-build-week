import { describe, expect, it } from "vitest";

import {
  evaluateQualityGate,
  parseQualityBenchmark,
  parseQualityEvidence,
  renderQualityGateMarkdown
} from "./evaluation-gate.js";

describe("evaluateQualityGate", () => {
  it("reports benchmark reliability separately from product and causal-learning evidence", () => {
    const report = evaluateQualityGate(
      {
        benchmarkVersion: "1.0.0",
        minimumStochasticRepetitions: 3,
        thresholds: {
          minimumScenarioPassRate: 2 / 3,
          maximumScenarioVariance: 0.25
        },
        releaseBlockers: ["incorrect-mathematics", "hidden-data-egress"],
        operationalBudgets: [
          { id: "cold-start-p95", unit: "ms", maximum: 2_000 }
        ],
        scenarios: [
          {
            id: "definition-domain",
            suite: "mathematics",
            kind: "stochastic",
            description: "Preserve the quantified domain of a definition."
          },
          {
            id: "privacy-denial",
            suite: "failure-recovery",
            kind: "deterministic",
            description: "Keep denied private context out of model input."
          }
        ]
      },
      {
        benchmarkVersion: "1.0.0",
        release: { id: "candidate-1", commit: "abc123" },
        recordedAt: "2026-07-20T00:00:00.000Z",
        versions: {
          application: "0.1.0",
          modelRuntime: "fixture-runtime-1",
          verifier: "lean-4.29.1-mathlib-4.29.1"
        },
        environment: {
          hardware: "fixture-mac",
          operatingSystem: "fixture-macos",
          node: "fixture-node",
          electron: "fixture-electron"
        },
        trials: [
          { scenarioId: "definition-domain", run: 1, passed: true, observedBlockers: [] },
          { scenarioId: "definition-domain", run: 2, passed: false, observedBlockers: [] },
          { scenarioId: "definition-domain", run: 3, passed: true, observedBlockers: [] },
          { scenarioId: "privacy-denial", run: 1, passed: true, observedBlockers: [] }
        ],
        operationalMeasurements: [
          { budgetId: "cold-start-p95", value: 1_500 }
        ],
        allowedExceptions: [],
        knownLimitations: ["Fixture evidence does not support a learning-impact claim."],
        productLearningObservations: ["A moderated evaluator completed the recovery journey."],
        causalLearningEvidence: {
          claimSupported: false,
          summary: "No randomized learning study has been run."
        }
      }
    );

    expect(report.decision).toBe("pass");
    const mathematics = report.benchmarkReliability.scenarios.find(
      (scenario) => scenario.scenarioId === "definition-domain"
    );
    expect(mathematics).toMatchObject({
      repetitions: 3,
      passRate: 2 / 3
    });
    expect(mathematics?.variance).toBeCloseTo(2 / 9);
    expect(report.productLearningObservations).toHaveLength(1);
    expect(report.causalLearningEvidence.claimSupported).toBe(false);
    expect(report.knownLimitations).toHaveLength(1);
  });

  it("fails a release blocker even when an exception attempts to waive it", () => {
    const report = evaluateQualityGate(
      {
        benchmarkVersion: "1.0.0",
        minimumStochasticRepetitions: 3,
        thresholds: {
          minimumScenarioPassRate: 1,
          maximumScenarioVariance: 0
        },
        releaseBlockers: ["dishonest-verification"],
        operationalBudgets: [],
        scenarios: [{
          id: "formal-claim-mismatch",
          suite: "mathematics",
          kind: "deterministic",
          description: "Match the checked statement to the learner-facing claim."
        }]
      },
      {
        benchmarkVersion: "1.0.0",
        release: { id: "candidate-2", commit: "def456" },
        recordedAt: "2026-07-20T00:00:00.000Z",
        versions: {
          application: "0.1.0",
          modelRuntime: "fixture-runtime-1",
          verifier: "lean-4.29.1-mathlib-4.29.1"
        },
        environment: {
          hardware: "fixture-mac",
          operatingSystem: "fixture-macos",
          node: "fixture-node",
          electron: "fixture-electron"
        },
        trials: [{
          scenarioId: "formal-claim-mismatch",
          run: 1,
          passed: false,
          observedBlockers: ["dishonest-verification"]
        }],
        operationalMeasurements: [],
        allowedExceptions: [{
          id: "exception-1",
          rationale: "Requested waiver",
          approvedBy: "fixture-evaluator",
          expiresOn: "2026-07-21"
        }],
        knownLimitations: [],
        productLearningObservations: [],
        causalLearningEvidence: {
          claimSupported: false,
          summary: "No causal claim."
        }
      }
    );

    expect(report.decision).toBe("fail");
    expect(report.failures).toContain(
      "Release blocker dishonest-verification observed in formal-claim-mismatch run 1."
    );
  });

  it("fails incomplete stochastic evidence, missed pass thresholds, and missing budgets", () => {
    const report = evaluateQualityGate(
      {
        benchmarkVersion: "1.0.0",
        minimumStochasticRepetitions: 5,
        thresholds: {
          minimumScenarioPassRate: 0.8,
          maximumScenarioVariance: 0.2
        },
        releaseBlockers: [],
        operationalBudgets: [
          { id: "memory-peak", unit: "MiB", maximum: 700 }
        ],
        scenarios: [{
          id: "ambiguous-input",
          suite: "mathematics",
          kind: "stochastic",
          description: "Ask for clarification before committing to a costly interpretation."
        }]
      },
      {
        benchmarkVersion: "1.0.0",
        release: { id: "candidate-3", commit: "987fed" },
        recordedAt: "2026-07-20T00:00:00.000Z",
        versions: {
          application: "0.1.0",
          modelRuntime: "fixture-runtime-1",
          verifier: "lean-4.29.1-mathlib-4.29.1"
        },
        environment: {
          hardware: "fixture-mac",
          operatingSystem: "fixture-macos",
          node: "fixture-node",
          electron: "fixture-electron"
        },
        trials: [
          { scenarioId: "ambiguous-input", run: 1, passed: true, observedBlockers: [] },
          { scenarioId: "ambiguous-input", run: 2, passed: false, observedBlockers: [] }
        ],
        operationalMeasurements: [],
        allowedExceptions: [],
        knownLimitations: [],
        productLearningObservations: [],
        causalLearningEvidence: {
          claimSupported: false,
          summary: "No causal claim."
        }
      }
    );

    expect(report.decision).toBe("fail");
    expect(report.failures).toEqual(expect.arrayContaining([
      "Scenario ambiguous-input has 2 runs; 5 are required.",
      "Scenario ambiguous-input pass rate 50.0% is below 80.0%.",
      "Scenario ambiguous-input variance 0.250 is above 0.200.",
      "Operational budget memory-peak has no measurement."
    ]));
  });

  it("rejects malformed and ambiguous evaluator input", () => {
    expect(() => parseQualityBenchmark({
      benchmarkVersion: "1.0.0",
      minimumStochasticRepetitions: 5,
      thresholds: { minimumScenarioPassRate: 0.8, maximumScenarioVariance: 0.2 },
      releaseBlockers: [],
      operationalBudgets: [],
      scenarios: [{
        id: "unscored-stochastic-item",
        suite: "mathematics",
        kind: "stochastic",
        description: "Missing its pinned item and rubric."
      }]
    })).toThrow("benchmark.scenarios[0] stochastic scenarios require fixture and successCriteria");

    expect(() => parseQualityBenchmark({
      benchmarkVersion: "1.0.0",
      minimumStochasticRepetitions: 5,
      thresholds: { minimumScenarioPassRate: 0.8, maximumScenarioVariance: 0.2 },
      releaseBlockers: [],
      operationalBudgets: [],
      scenarios: [
        { id: "duplicate", suite: "mathematics", kind: "deterministic", description: "One" },
        { id: "duplicate", suite: "failure-recovery", kind: "deterministic", description: "Two" }
      ]
    })).toThrow("benchmark.scenarios contains duplicate id duplicate");

    expect(() => parseQualityEvidence({
      benchmarkVersion: "1.0.0",
      release: { id: "candidate", commit: "abc" },
      recordedAt: "not-a-date",
      versions: { application: "0.1.0", modelRuntime: "runtime", verifier: "verifier" },
      environment: {
        hardware: "fixture-mac",
        operatingSystem: "fixture-macos",
        node: "fixture-node",
        electron: "fixture-electron"
      },
      trials: [],
      operationalMeasurements: [],
      allowedExceptions: [],
      knownLimitations: [],
      productLearningObservations: [],
      causalLearningEvidence: { claimSupported: false, summary: "None" }
    })).toThrow("evidence.recordedAt must be an ISO-8601 date-time");
  });

  it("renders an inspectable report with decisions, versions, exceptions, and limitations", () => {
    const report = evaluateQualityGate(
      {
        benchmarkVersion: "1.0.0",
        minimumStochasticRepetitions: 1,
        thresholds: { minimumScenarioPassRate: 1, maximumScenarioVariance: 0 },
        releaseBlockers: [],
        operationalBudgets: [{ id: "disk-use", unit: "MiB", maximum: 1_500 }],
        scenarios: [{
          id: "source-discrepancy",
          suite: "mathematics",
          kind: "deterministic",
          description: "Retain conflicting sources."
        }]
      },
      {
        benchmarkVersion: "1.0.0",
        release: { id: "candidate-4", commit: "123abc" },
        recordedAt: "2026-07-20T00:00:00.000Z",
        versions: {
          application: "0.1.0",
          modelRuntime: "runtime-1",
          verifier: "verifier-1"
        },
        environment: {
          hardware: "Apple Silicon fixture",
          operatingSystem: "macOS 15 fixture",
          node: "Node 24 fixture",
          electron: "Electron 43.1.1"
        },
        trials: [{
          scenarioId: "source-discrepancy",
          run: 1,
          passed: true,
          observedBlockers: []
        }],
        operationalMeasurements: [{ budgetId: "disk-use", value: 1_200 }],
        allowedExceptions: [{
          id: "ui-note",
          rationale: "Non-blocking wording review remains.",
          approvedBy: "release-owner",
          expiresOn: "2026-07-27"
        }],
        knownLimitations: ["No causal learning claim is supported."],
        productLearningObservations: ["One moderated walkthrough completed."],
        causalLearningEvidence: {
          claimSupported: false,
          summary: "No randomized study."
        }
      }
    );

    const markdown = renderQualityGateMarkdown(report);
    expect(markdown).toContain("# Quality Gate Report: candidate-4");
    expect(markdown).toContain("**Decision:** PASS");
    expect(markdown).toContain("runtime-1");
    expect(markdown).toContain(
      "Apple Silicon fixture · macOS 15 fixture · Node 24 fixture · Electron 43.1.1"
    );
    expect(markdown).toContain("Minimum stochastic repetitions: 1");
    expect(markdown).toContain("Minimum scenario pass rate: 100.0%");
    expect(markdown).toContain("source-discrepancy | mathematics | 1 | 100.0% | 0.000 | pass");
    expect(markdown).toContain("disk-use | 1200 MiB | <= 1500 MiB | pass");
    expect(markdown).toContain("ui-note: Non-blocking wording review remains.");
    expect(markdown).toContain("No causal learning claim is supported.");
    expect(markdown).toContain("Causal educational impact: not supported");
  });

  it("fails duplicate or unrecognized evidence instead of inflating reliability", () => {
    const report = evaluateQualityGate(
      {
        benchmarkVersion: "1.0.0",
        minimumStochasticRepetitions: 2,
        thresholds: { minimumScenarioPassRate: 1, maximumScenarioVariance: 0 },
        releaseBlockers: [],
        operationalBudgets: [{ id: "cold-start", unit: "ms", maximum: 2000 }],
        scenarios: [{
          id: "known-scenario",
          suite: "mathematics",
          kind: "stochastic",
          description: "Known scenario."
        }]
      },
      {
        benchmarkVersion: "1.0.0",
        release: { id: "candidate-5", commit: "aaa111" },
        recordedAt: "2026-07-20T00:00:00.000Z",
        versions: { application: "0.1.0", modelRuntime: "runtime", verifier: "verifier" },
        environment: {
          hardware: "fixture-mac",
          operatingSystem: "fixture-macos",
          node: "fixture-node",
          electron: "fixture-electron"
        },
        trials: [
          { scenarioId: "known-scenario", run: 1, passed: true, observedBlockers: [] },
          { scenarioId: "known-scenario", run: 1, passed: true, observedBlockers: [] },
          { scenarioId: "unknown-scenario", run: 1, passed: true, observedBlockers: [] }
        ],
        operationalMeasurements: [
          { budgetId: "cold-start", value: 1000 },
          { budgetId: "cold-start", value: 900 },
          { budgetId: "unknown-budget", value: 1 }
        ],
        allowedExceptions: [],
        knownLimitations: [],
        productLearningObservations: [],
        causalLearningEvidence: { claimSupported: false, summary: "No causal claim." }
      }
    );

    expect(report.decision).toBe("fail");
    expect(report.failures).toEqual(expect.arrayContaining([
      "Scenario known-scenario contains duplicate run 1.",
      "Evidence contains unknown scenario unknown-scenario.",
      "Operational budget cold-start contains duplicate measurements.",
      "Evidence contains unknown operational budget unknown-budget."
    ]));
  });
});
