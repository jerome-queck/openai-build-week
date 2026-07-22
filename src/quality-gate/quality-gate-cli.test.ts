import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runQualityGate } from "./quality-gate-cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("runQualityGate", () => {
  it("writes inspectable JSON and Markdown reports for the versioned fixture", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "quick-study-quality-gate-"));
    temporaryDirectories.push(outputDirectory);

    const result = await runQualityGate({
      benchmarkPath: resolve("evaluation/benchmarks/v2/benchmark.json"),
      evidencePath: resolve("evaluation/fixtures/passing-evidence-v2.json"),
      outputDirectory
    });

    expect(result.report.decision).toBe("pass");
    expect(result.exitCode).toBe(0);
    const jsonReport = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      benchmarkVersion: string;
      benchmarkReliability: { scenarios: unknown[] };
    };
    expect(jsonReport.benchmarkVersion).toBe("2.1.0");
    expect(jsonReport.benchmarkReliability.scenarios).toHaveLength(16);
    expect(await readFile(result.markdownPath, "utf8")).toContain(
      "Causal educational impact: not supported"
    );
  });

  it("keeps parsed advisory misses non-blocking while omitted enforcement remains release-blocking", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "quick-study-quality-gate-enforcement-"));
    temporaryDirectories.push(temporaryDirectory);
    const benchmark = JSON.parse(await readFile(
      resolve("evaluation/benchmarks/v2/benchmark.json"), "utf8"
    )) as {
      operationalBudgets: Array<{ id: string; enforcement?: string }>;
      scenarios: Array<{ fixture?: string }>;
    };
    const evidence = JSON.parse(await readFile(
      resolve("evaluation/fixtures/passing-evidence-v2.json"), "utf8"
    )) as { operationalMeasurements: Array<{ budgetId: string; value: number }> };
    evidence.operationalMeasurements.find((measurement) => measurement.budgetId === "peak-memory")!.value = 1052;
    for (const scenario of benchmark.scenarios) {
      if (scenario.fixture) scenario.fixture = resolve("evaluation/benchmarks/v2", scenario.fixture);
    }
    const benchmarkPath = join(temporaryDirectory, "benchmark.json");
    const evidencePath = join(temporaryDirectory, "evidence.json");
    await writeFile(benchmarkPath, JSON.stringify(benchmark), "utf8");
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");

    const advisory = await runQualityGate({
      benchmarkPath, evidencePath, outputDirectory: join(temporaryDirectory, "advisory")
    });
    expect(advisory.exitCode).toBe(0);
    expect(advisory.report.operationalBudgets.find((budget) => budget.id === "peak-memory"))
      .toMatchObject({ enforcement: "advisory", measured: 1052, passed: false });

    delete benchmark.operationalBudgets.find((budget) => budget.id === "peak-memory")!.enforcement;
    await writeFile(benchmarkPath, JSON.stringify(benchmark), "utf8");
    const required = await runQualityGate({
      benchmarkPath, evidencePath, outputDirectory: join(temporaryDirectory, "required")
    });
    expect(required.exitCode).toBe(1);
    expect(required.report.failures).toContain(
      "Operational budget peak-memory measured 1052 MiB, above 1024 MiB."
    );
  });
});
