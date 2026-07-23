# Coding standards

This document is the primary repository standard for code-review decisions that require engineering judgement. It complements the executable checks in [`package.json`](package.json), TypeScript configuration, and CI rather than restating what those tools already enforce.

Contributors must also follow the workflow in [`CONTRIBUTING.md`](CONTRIBUTING.md), use the domain language in [`CONTEXT.md`](CONTEXT.md), and honour the architectural decisions under [`docs/adr/`](docs/adr/). A relevant ADR remains authoritative until an approved change supersedes it; do not let implementation drift silently contradict it.

## Preserve the product boundaries

- Route durable product state and behaviour through the typed `LearningApplication` and `LearnerAction` boundary described in the [architecture guide](docs/architecture.md). Renderer components may own transient view state, but they must not duplicate persistence, session lifecycle, access-policy, or model-orchestration rules.
- Keep Electron main and preload code as narrow adapters. The renderer must use the typed preload API rather than importing Node or Electron capabilities directly.
- Treat IPC, model output, persisted data, URLs, and other process or service inputs as untrusted. Validate payloads at runtime, verify IPC senders, allow only intended protocols and destinations, and retain Electron sandboxing, context isolation, navigation protection, and disabled Node integration.
- Keep domain state, persisted formats, and renderer behaviour platform-neutral. Isolate macOS-specific facilities behind narrow adapters in accordance with [ADR-0002](docs/adr/0002-build-macos-first-with-a-portable-electron-core.md).

These rules preserve public seams, not today's file sizes. Internal modules may be extracted as the implementation grows as long as responsibility does not leak across the boundaries.

## Protect durable state and identity

- Serialize durable state changes and persist them atomically. A failed write must not replace the last valid state with a partial document.
- Treat persisted-schema compatibility as part of every state-model change. Supply migration or defaults for existing data and cover launch, mutation, quit, and relaunch when the change can affect restoration.
- Update coupled lifecycle invariants as one domain operation. Session status, active and resumable identity, activity order, navigation, and running model work must not drift into contradictory states.
- Preserve identity when moving or filing domain entities. Do not recreate an entity merely to change its location, and do not encode opaque identifiers into delimiter-dependent UI values.
- Scope transient drafts to the entity they edit. Switching a Learning Session, Study Workspace, or Study Mission must not leak stale form state from the previous entity.
- Never persist real credentials in `LearningApplicationState`, learner-facing records, logs, or fixtures. Tests must use unmistakably synthetic sentinel values.

## Bound model and background work

- Keep provider and transport details behind the `ModelRuntime` boundary established by [ADR-0020](docs/adr/0020-use-codex-app-server-as-the-version-one-model-runtime.md). Product state must not depend directly on Codex thread or protocol shapes.
- Validate runtime responses and translate failures into honest, actionable product states. External or background work must be bounded, cancellable, and unable to remain indefinitely `streaming` after transport loss, cancellation, shutdown, or relaunch.
- Checkpoint useful partial learner-facing output, but keep raw tool events and agent execution records in the Agent Work Log rather than the Session Record or learner-facing state, following [ADR-0004](docs/adr/0004-separate-agent-work-logs-from-learning-output.md).
- Loss of model access must not disable local work. Never silently retry model spending after restart or access recovery; require a learner action, as required by [ADR-0022](docs/adr/0022-keep-local-work-available-without-model-access.md) and [ADR-0024](docs/adr/0024-bound-agent-work-to-the-running-app.md).

## Use the domain language

- Use the canonical terms and distinctions in [`CONTEXT.md`](CONTEXT.md) in code, tests, issues, and learner-facing copy. Do not introduce an explicitly avoided synonym for an established concept.
- Model domain distinctions in types and behaviour instead of relying only on labels or presentation text. In particular, do not conflate Session Status with understanding, Claim Origin with Verification Level, or learner-facing Session Records with internal Agent Work Logs.
- If implementation work exposes a missing or incorrect domain term, resolve it through the domain-model and ADR workflow rather than inventing parallel vocabulary inside one feature.

## Keep the interface accessible and honest

- Prefer semantic HTML and native controls. Every interactive path must be keyboard operable and have an accessible name that describes the action and, when needed, the affected domain entity.
- Expose asynchronous status and errors through appropriate accessible semantics. Do not rely on colour, animation, or visual position alone.
- Show failures, stopped work, unavailable capabilities, provenance, and verification at their honest state. Do not present model confidence, task completion, or source origin as mathematical correctness or learner understanding.

## Test behaviour at the right seam

- Test observable product behaviour through the public `LearningApplication` interface with deterministic fakes and isolated temporary data. Do not reach into private implementation details to make a test pass.
- Test Model Runtime transports at their adapter boundary with scripted protocol fixtures. Unit and integration tests must not depend on live model, network, account, or learner data.
- Reserve packaged Playwright coverage for critical behaviour that crosses the renderer, preload, main process, filesystem, packaging, or relaunch boundary. Use exact accessible role and name locators for primary journeys instead of styling or DOM-structure selectors.
- Add a regression test when fixing a behavioural defect. Persisted-schema and lifecycle changes require restoration coverage; cancellation and failure paths require deterministic terminal-state coverage.
- Follow the vertical red-green workflow in [`CONTRIBUTING.md`](CONTRIBUTING.md#implementation). The full current command set and release-order verification live in the [development guide](docs/development.md) and `package.json`.

## Evolve these standards deliberately

Update this document in the same pull request when a change deliberately alters a durable contract covered here, including an architecture boundary, trust or access rule, persistence invariant, lifecycle guarantee, test seam, or authoritative tooling expectation. Also update it when repeated review findings reveal a missing repository-wide rule or when an ADR supersedes an existing rule.

Do not add a standard for a one-off implementation tactic, ticket-specific acceptance criterion, personal formatting preference, or rule already enforced clearly by tooling. If formatting or import policy becomes important, automate it first and make the tool configuration authoritative.

Every material pull request should include a quick standards-impact check. Perform a fuller audit before a major release and after substantial architecture, runtime, build, CI, or review-skill changes. There is no calendar requirement to rewrite this document when the engineering contract has not changed.
