# Quality and learning evaluation

This directory owns the reproducible evidence gate for a release candidate. It deliberately keeps three questions separate:

1. **Benchmark reliability:** did the candidate meet the mathematical, recovery, safety, accessibility, and operational thresholds?
2. **Product-learning observations:** what did moderated use reveal about comprehension, reasoning, cognitive load, and navigation?
3. **Causal educational impact:** does an appropriately designed comparative study support a learning claim?

A passing automated report answers only the first question. The automated evidence schema accepts only `claimSupported: false`; causal support requires separately governed study evidence and cannot be self-awarded by this gate. The checked-in fixture proves that the harness runs; it is not release evidence and cannot support a product or learning claim.

## Run a release gate

Use the supported Node 24 release lane. Copy `evaluation/fixtures/passing-evidence-v1.json` outside the fixture directory, replace every sentinel version and measurement, and replace every trial with evidence collected from the candidate. Do not present fixture values as measurements.

```sh
npm ci
npm run verify
npm run quality:gate -- \
  --benchmark evaluation/benchmarks/v1/benchmark.json \
  --evidence /absolute/path/to/release-evidence.json \
  --out /absolute/path/to/quality-report
```

The command validates both files, writes JSON and Markdown reports, and exits `1` for a failed decision (`2` for invalid input). `--evidence` is mandatory and never defaults to the passing fixture. `npm run verify` runs `quality:gate:fixture` only as a deterministic harness regression.

## Collect benchmark evidence

- Pin the candidate commit and record the exact application, Model Runtime, Verifier Runtime, operating system, hardware, Node, and Electron versions.
- Fill every `provenance` field with the immutable revision and lowercase SHA-256 digest used for the run: the corpus bundle, prompt set, evaluation policy, each source revision, and the exact Verification Environment Manifest. Record every evaluator tool and version. Sentinel fixture digests are invalid release evidence.
- Present each item under `benchmarks/v1/corpus/` verbatim. Use a fresh runtime context and the same declared policy, tools, budgets, and source revisions for every run.
- Run every `stochastic` scenario at least five times. Two blinded mathematics evaluators independently apply the checked-in criteria, reconcile disagreements, and record one boolean verdict per run. Reported variance is Bernoulli variance `p(1-p)`; do not keep rerunning until a favorable pass rate appears.
- Follow `benchmarks/v1/recovery-procedures.md` for deterministic failure injection. Record an initial failure even if a later retry succeeds.
- Copy any observed stop-ship class into `observedBlockers`. Release blockers are non-waivable: incorrect or overclaimed mathematics, hidden data egress, source mutation, corrupted durable state, dishonest verification, unrecoverable work, and an inaccessible critical journey.
- Keep exceptions narrow, named, approved, expiring, and visible. Exceptions are report annotations; they cannot turn a threshold miss or release blocker into a pass.
- Record unknowns under `knownLimitations`. Missing evidence is a gate failure, not a limitation.

The v1 threshold requires at least an 80% pass rate per scenario and variance at most `0.2`. Thresholds and corpus items change only through a new benchmark version so historical reports remain interpretable.

## Measure operational budgets

Use the same supported Mac and fixed candidate policy for all repeats. Warm-up runs are labelled and excluded consistently. Retain raw timestamps, process samples, `du` output, and provider usage receipts with the evidence bundle.

| Budget | Measurement procedure |
| --- | --- |
| `cold-start-p95` | Launch the packaged app into an isolated data directory at least 20 times; measure process start to the first keyboard-operable Session Intake. |
| `peak-memory` | Sample the packaged Electron process tree's resident memory during the benchmark and report the maximum aggregate MiB. |
| `source-index-p95` | Index the pinned large-source fixture repeatedly from an empty Source Index and report p95 completion latency. |
| `verifier-footprint` | Measure the installed active environment plus retained packaged verifier payload with `du`; report logical MiB and retain the raw output. |
| `teaching-latency-p95` | Measure learner submission to first complete useful Teaching Card for stochastic mathematics runs. |
| `agent-latency-p95` | Measure explicit dispatch to terminal or checkpointed Agent Task state, including failures and cancellations. |
| `application-disk-use` | Measure the packaged app, isolated application data, indexes, and active verifier after the complete suite. Imported Linked Sources are excluded. |
| `model-tool-cost` | Sum model and paid-tool usage receipts per completed Learning Session; do not estimate missing usage as zero. |

The v1 numbers are explicit provisional engineering budgets for the supported benchmark machine, not universal research-backed constants. A threshold change requires rationale and a new benchmark version.

## Run the learning protocol

Use `studies/v1/moderated-learning-study.md` and its instrument. Moderated observations can diagnose product behavior, but a causal learning claim still requires the randomized, time-matched, blinded design described in `docs/research/math-learning-evaluation-framework.md`. Store consented study data outside the repository and never commit learner records.
