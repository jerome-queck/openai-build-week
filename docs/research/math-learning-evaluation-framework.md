# Evaluation framework for advanced-mathematics learning

Research date: 2026-07-18

## Recommendation

Use a **layered scorecard**, not one blended score. The product succeeds only when it improves demonstrated learning, does not cross mathematical-trust or human-factors guardrails, and operates within explicit service budgets. Time in app, completion, card reuse, and learner satisfaction are useful diagnostics, but they are not Understanding Evidence.

The compact evaluation loop is:

1. **Every build:** run a fixed, versioned mathematics and failure-recovery benchmark.
2. **Every material interaction change:** run short moderated task tests with target learners.
3. **Before claiming learning impact:** run a powered, randomized, time-matched study with an immediate post-test and at least one delayed test.

Educational scores need evidence that they support their intended interpretation, not merely high face validity; NCME's open *Educational Measurement* covers validity and reliability, while the US Department of Education's [What Works Clearinghouse (WWC) Handbook 5.0](https://ies.ed.gov/ncee/wwc/Handbooks) is the practical standard for causal education studies, including randomization, attrition, baseline equivalence, and outcome reporting ([NCME](https://ncme.org/resources/books/educational-measurement/)).

## The scorecard

### Primary learning outcomes

| Dimension | Product-development measure | Interpretation |
| --- | --- | --- |
| **Immediate learning gain** | Blind, expert-rubric score on an **unassisted** parallel-form pre-test and post-test, adjusted for baseline; report the mean difference or standardized mean difference with a confidence interval. | Answers whether one Learning Session improved what the learner can recognize, explain, apply, or prove. Do not use assisted practice, completion, or a raw “normalized gain” as a substitute. |
| **Near transfer** | Held-out problem using the same concept or proof method but different surface details, examples, or notation; no item may have appeared in tutoring context. | Shows that the learner learned more than the exact worked example. |
| **Far transfer** | Uncued item that changes a predeclared combination of domain, representation, goal, or method-selection demand; score both strategy selection and correctness. | “Far” must be operationalized, not asserted. Barnett and Ceci show that transfer varies along multiple content and context dimensions, so one undifferentiated transfer score is misleading ([paper](https://doi.org/10.1037/0033-2909.128.4.612)). |
| **Delayed retention** | A fresh parallel form after 7 days; add 30 days for a field study. Report retained score and decay from immediate post-test. Keep retrieval/test exposure equal across arms. | Immediate fluency can diverge from later retention; Roediger and Karpicke found different immediate and delayed patterns, so an immediate post-test alone cannot establish durable learning ([paper](https://doi.org/10.1111/j.1467-9280.2006.01693.x)). |
| **Metacognitive calibration** | After every assessment item, collect the learner's 0–100% confidence. Report calibration bias, absolute calibration error or Brier score, and discrimination between correct and incorrect answers; report overconfidence separately. | Mean confidence is not calibration. Schraw compares complementary measures of metacognitive monitoring and cautions against treating them as interchangeable ([paper](https://doi.org/10.1007/s11409-008-9031-3)). |
| **Proof comprehension and error detection** | Use unfamiliar valid and seeded-invalid proofs. Score: verdict, error localization, explanation/repair, meaning of statements, logical status and chaining, high-level idea, modules, method, and relation to examples. | The rubric follows the multidimensional undergraduate proof-comprehension model of Mejia-Ramos et al. ([paper](https://doi.org/10.1007/s10649-011-9349-7)). Include invalid proofs because students can attend to surface form while missing warrants or validity failures ([Inglis and Alcock](https://doi.org/10.5951/jresematheduc.43.4.0358)). |
| **Adaptive-teaching uplift** | Randomize learners or matched topics to the adaptive Teaching-Move policy versus the same interface, model, content pool, time budget, and checks under a fixed or yoked policy. The uplift is the between-condition difference on the outcomes above. | Adaptation is a causal contrast, not a standalone questionnaire score. A comparison with “no app” cannot isolate adaptation. Follow WWC design rules; tutoring effectiveness depends strongly on the comparator and interaction granularity ([VanLehn](https://doi.org/10.1080/00461520.2011.611369)). |

Predeclare **one primary outcome and a minimally important difference** for each causal study; treat the others as confirmatory or exploratory. Do not average away a transfer or retention failure. In an underpowered pilot, report estimates and uncertainty and say that impact is not yet established.

### Guardrails and product-quality outcomes

| Dimension | Measure | Release implication |
| --- | --- | --- |
| **Mathematical correctness** | On a stratified, versioned corpus, two blinded expert raters score each substantive claim, assumption, dependency, example, and final conclusion; adjudicate disagreements. Report critical errors per 100 claims and by mathematical domain/difficulty. | A fluent response with a load-bearing error fails. Whole-response “looks correct” ratings hide the failure unit. |
| **Verification honesty and system calibration** | Cross-tab expert correctness separately against Claim Origin (`Learner`, `Supplied source`, `Model-generated`, or mixed) and Verification Level (`Not independently checked`, `Independently checked`, or `Formally verified`), stratified by Verification Currency. Separately measure incorrect high-assurance claims, stale-currency failures, and whether the checked formal statement matches the learner-facing claim. If the system emits probabilities, report a reliability diagram, Brier score, and expected calibration error. | False assurance is a stop-ship class, especially an incorrect or mismatched `Formally verified` claim. Model confidence cannot waive checking. Confidence calibration is distinct from accuracy ([Guo et al.](https://proceedings.mlr.press/v70/guo17a.html)); NIST likewise calls for empirically validated, context-specific GenAI measurement ([NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1)). |
| **Mental effort and usability** | After each target task, collect the Paas 9-point mental-effort item; also record task success, time, backtracking, help needed, and a short satisfaction item. Diagnose by expertise and task complexity. | Reject changes that buy small score gains through materially higher reported mental effort or prevent task completion. Do not infer a specific source of cognitive load from the single item alone. The Paas scale was developed in mathematical problem-solving research ([paper](https://doi.org/10.1037/0022-0663.84.4.429)); effectiveness, efficiency, and satisfaction are the core usability dimensions in [ISO 9241-11](https://www.iso.org/standard/63500.html). |
| **Artifact usefulness and resumption** | After a 48–72 hour interruption, give either the Resume Card plus Consolidated Session Outcome or a time/content-matched baseline artifact. Before model help, measure correct identification of the Learning Goal, Return Point, unresolved issue, and next action; then measure time-to-correct-resumption and downstream task correctness. | Artifact clicks and self-reported usefulness are secondary. The behavioral target is shorter resumption lag without an orientation or correctness penalty; resumption lag is an established interruption-recovery measure ([Trafton et al.](https://doi.org/10.1016/S1071-5819(03)00023-5)). |

### Operational metrics and diagnostics

Measure by task complexity, hardware, model/runtime version, and verification path:

- **Latency:** p50/p95 time to first useful Teaching Card, complete card, source-grounded check, and Lean result.
- **Reliability:** valid-completion, timeout, retry, cancellation, crash-free-session, no-data-loss, source-anchor integrity, verifier success, and correct fallback rates; include injected model, network, source, and verifier failures.
- **Local-first performance:** peak CPU/RAM, energy where available, index size, verifier disk footprint, and time to reopen a large Study Workspace.
- **Cost:** model calls/tokens and spend per completed Learning Session; later, cost per learner achieving delayed retention or transfer. Keep infrastructure cost separate from evaluator/research labor.
- **Behavioral diagnostics:** skipped Understanding Checks, requested variants, artifact edits/reuse, and abandonment point. Use these to explain outcomes, never to label mastery.

Set p95, reliability, and cost budgets against the supported hardware and the fixed-policy baseline. There is no research-backed universal latency or cost threshold for this product. Pin the benchmark corpus, prompts, source revisions, model/runtime, and Verification Environment Manifest so changes are attributable and reproducible.

## Minimal study designs

| Stage | Design | Decision it supports |
| --- | --- | --- |
| **Component gate** | Fixed corpus spanning definitions, computations, proof steps, invalid arguments, source discrepancies, and verification-state edge cases; repeated runs for stochastic paths. | Whether a build is mathematically safer and operationally no worse. |
| **Formative product test** | Moderated sessions with target advanced-mathematics learners; counterbalanced tasks; mental effort, task success/time, and observed failure recovery. Add the delayed resumption task. | Why the workbench, proof reader, or artifact fails and what to change next. Not a learning-impact claim. |
| **Causal pilot** | Randomized, time-matched adaptive versus fixed/yoked policy; parallel pre/post forms; blinded scoring; 7-day follow-up; preregistered outcome, harm margin, attrition handling, and analysis. Power from the minimally important difference and assessment reliability rather than an arbitrary sample count. | Whether adaptation improves immediate learning and preserves transfer, retention, calibration, correctness, and burden. |
| **Field validation** | Multi-session use over 4–6 weeks with a 2–4 week follow-up, realistic sources, and prespecified subgroup checks by prior knowledge and mathematical domain. | Whether the effect survives real resumption, source variation, and repeated use. |

## Decision rule

A product iteration is a **learning win** only if the preregistered primary point estimate reaches its minimally important difference and its confidence interval excludes the preset material-harm margin (or, for an early pilot, is directionally promising with uncertainty stated), delayed retention and transfer also exclude material harm, and no guardrail regresses beyond its risk budget. An adaptive policy that fails this contrast should fall back to the fixed policy. Any observed false `Formally verified` claim, silent data loss, or unrecoverable session corruption is a release blocker; report the binomial confidence bound as well as the observed zero/one count.

Keep the scorecard disaggregated. A fast, delightful, inexpensive system that does not improve held-out mathematical performance is a usable study tool, not yet an evidence-backed learning intervention.
