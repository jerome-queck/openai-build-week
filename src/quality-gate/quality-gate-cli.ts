import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  evaluateQualityGate,
  parseQualityBenchmark,
  parseQualityEvidence,
  renderQualityGateMarkdown,
  type QualityGateReport
} from "./evaluation-gate.js";

export interface QualityGateOptions {
  benchmarkPath: string;
  evidencePath: string;
  outputDirectory: string;
}

export interface QualityGateRunResult {
  report: QualityGateReport;
  jsonPath: string;
  markdownPath: string;
  exitCode: 0 | 1;
}

export async function runQualityGate(options: QualityGateOptions): Promise<QualityGateRunResult> {
  const [benchmarkText, evidenceText] = await Promise.all([
    readFile(options.benchmarkPath, "utf8"),
    readFile(options.evidencePath, "utf8")
  ]);
  const benchmark = parseQualityBenchmark(parseJson(benchmarkText, options.benchmarkPath));
  const evidence = parseQualityEvidence(parseJson(evidenceText, options.evidencePath));
  await Promise.all(benchmark.scenarios.flatMap((scenario) =>
    scenario.fixture
      ? [readFile(resolve(dirname(options.benchmarkPath), scenario.fixture), "utf8")]
      : []
  ));
  const report = evaluateQualityGate(benchmark, evidence);
  const safeReleaseId = report.release.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const jsonPath = join(options.outputDirectory, `${safeReleaseId}.json`);
  const markdownPath = join(options.outputDirectory, `${safeReleaseId}.md`);
  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderQualityGateMarkdown(report), "utf8")
  ]);
  return {
    report,
    jsonPath,
    markdownPath,
    exitCode: report.decision === "pass" ? 0 : 1
  };
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readOptions(arguments_: string[]): QualityGateOptions {
  let benchmarkPath = resolve("evaluation/benchmarks/v1/benchmark.json");
  let evidencePath: string | undefined;
  let outputDirectory = resolve("quality-gate-report");
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if ((argument === "--benchmark" || argument === "--evidence" || argument === "--out") && !value) {
      throw new Error(`${argument} requires a path`);
    }
    if (argument === "--benchmark") benchmarkPath = resolve(value!);
    else if (argument === "--evidence") evidencePath = resolve(value!);
    else if (argument === "--out") outputDirectory = resolve(value!);
    else throw new Error(`Unknown argument ${argument}`);
    index += 1;
  }
  if (!evidencePath) {
    throw new Error("--evidence is required; release evidence must never default to a passing fixture");
  }
  return { benchmarkPath, evidencePath, outputDirectory };
}

async function main(): Promise<void> {
  try {
    const result = await runQualityGate(readOptions(process.argv.slice(2)));
    process.stdout.write(
      `${result.report.decision.toUpperCase()}: ${basename(result.markdownPath)} and ${basename(result.jsonPath)}\n`
    );
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && basename(process.argv[1]) === "quality-gate-cli.js") {
  void main();
}
