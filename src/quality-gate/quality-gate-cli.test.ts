import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      benchmarkPath: resolve("evaluation/benchmarks/v1/benchmark.json"),
      evidencePath: resolve("evaluation/fixtures/passing-evidence-v1.json"),
      outputDirectory
    });

    expect(result.report.decision).toBe("pass");
    expect(result.exitCode).toBe(0);
    const jsonReport = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      benchmarkVersion: string;
      benchmarkReliability: { scenarios: unknown[] };
    };
    expect(jsonReport.benchmarkVersion).toBe("1.0.0");
    expect(jsonReport.benchmarkReliability.scenarios).toHaveLength(16);
    expect(await readFile(result.markdownPath, "utf8")).toContain(
      "Causal educational impact: not supported"
    );
  });
});
