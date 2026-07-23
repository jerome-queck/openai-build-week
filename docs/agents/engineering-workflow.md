# Engineering workflow for agents

This document adapts the installed Matt Pocock skills to this repository. The skills under [`.agents/skills`](../../.agents/skills) remain the canonical procedures; this file defines only the repository-specific routing, gates, and lifecycle around them. When the user explicitly asks which flow fits, use [`/ask-matt`](../../.agents/skills/ask-matt/SKILL.md).

## Choose the flow

```text
product idea -> /grill-with-docs
  |-- runnable uncertainty -> /handoff -> fresh /prototype -> /handoff back
  |-- approved one-session change -> concise GitHub Issue -> /implement here
  `-- approved multi-session change -> /to-spec -> /to-tickets
                                       -> fresh /implement per unblocked child
```

Other entry points:

- Use `/diagnosing-bugs` for a hard bug whose cause is not yet known.
- Use `/triage` only for incoming issues the user or team did not create. A ticket produced by `/to-tickets`, or a concise issue written after grilling, is already deliberate work and does not go through triage.
- Start a fresh `/implement` context for an existing ready ticket.
- Use `/ask-matt` when the user explicitly asks which skill or flow applies.

`/wayfinder` is an optional advanced flow and is not enabled for normal work in this repository. Do not invoke it or provision its labels unless the user explicitly opts into that workflow.

## Keep planning context continuous

Keep `/grill-with-docs`, `/to-spec`, and `/to-tickets` in one continuous context so decisions made while sharpening the idea survive into the spec and ticket boundaries.

Use `/handoff` when runnable uncertainty needs a prototype. Start `/prototype` in a fresh context, then hand the result back to the planning context. Once a multi-session plan is ticketed, start each unblocked child with a fresh `/implement` context. An approved one-session change can continue directly into `/implement` after its concise issue is created.

There is no fixed token threshold for a handoff. Handoff when accumulated exploration is making instructions or decisions unreliable, when a clean worker would understand the bounded task better, or when the next phase needs materially different context. Do not split a coherent planning chain merely because it is long.

## Record approved work

After the user approves a one-session change, create a concise GitHub Issue that records the intended outcome, scope, acceptance criteria, and verification. Apply `ready-for-agent`; do not send it through `/triage`.

For multi-session work, `/to-spec` creates the parent planning issue and `/to-tickets` creates implementation children. The parent is the planning index and shared acceptance contract. Each child is an independently claimable implementation unit.

## Route documentation changes

Tracked implementation work updates the owning human document in the same change when it affects public behavior, supported setup, a command, verification, packaging, release evidence, architecture responsibilities, trust boundaries, licensing, or contribution policy. Use the repository's canonical routes:

- [`README.md`](../../README.md) for the product-facing gateway and user expectations.
- [`docs/development.md`](../../docs/development.md) for development setup, commands, verification, packaging, smoke tests, and troubleshooting.
- [`docs/architecture.md`](../../docs/architecture.md) for stable component responsibilities, public seams, persistence, and trust boundaries.
- [`docs/beta-release.md`](../../docs/beta-release.md) for user-facing beta installation, privacy, recovery, and feedback guidance.
- [`evaluation/README.md`](../../evaluation/README.md) for candidate evidence and learning-evaluation procedures.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for public participation and maintainer workflow; [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md) remains the review contract.

Use links between these owners rather than introducing a competing command matrix or architecture overview. `package.json` and [macOS CI](../../.github/workflows/macos-ci.yml) are the executable sources and must be checked when their documented behavior changes. Do not edit the vendored Matt skills to encode these repository routes.

## Gate `/implement`

Before changing product code:

1. Read the entire issue, its comments and labels, its linked parent (if any), and the parent spec relevant to the child.
2. Confirm the issue is open and labelled `ready-for-agent`.
3. Confirm every native dependency, or every fallback `Blocked by:` reference, is closed.
4. Never implement a parent spec that has been decomposed. Select an unblocked child while any remain open; when all children are closed, follow [Complete a parent spec](#complete-a-parent-spec) instead.
5. Confirm no other implementer owns the issue. For autonomous pickup, require it to be unassigned and claim it by assigning yourself. If the user explicitly asks to resume an already claimed issue, verify its current driver and branch instead. Use the detailed mechanics in [Issue tracker: GitHub](issue-tracker.md#picking-up-implementation-work).
6. Update local `main`, then create an issue branch following [CONTRIBUTING.md](../../CONTRIBUTING.md). Never run tracked product `/implement` work directly on `main`.

Allow only one active implementer per issue. Assignment is a coordination signal, not an atomic lock: agents may share one GitHub identity, and two sessions can race between the availability check and assignment. Recheck coordination immediately after claiming and stop if another implementation is active.

## Use TDD at agreed seams

Follow the installed [`/tdd`](../../.agents/skills/tdd/SKILL.md) procedure. Agree the observable public seams first, then work in vertical red-green slices: one failing behavioral test, the minimum implementation, then the next slice. Do not test private implementation details or create a horizontal batch of speculative tests.

Run focused tests and typechecking during implementation, then the full relevant verification before review. If review exposes a behavioral defect, add or strengthen the regression test at the agreed seam before fixing it. Leave structural refactoring for the review/remediation stage while keeping the suite green.

## Review a committed candidate

The installed `/code-review` skill compares the merge base with committed `HEAD`, while `/implement` currently places review before its commit step. Until an upstream skill update resolves that mismatch, use this repository adapter:

Use [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md) as the primary source for the Standards axis. It points to the contextual domain and architecture decisions that apply in addition to the review skill's built-in smell baseline.

1. Finish the ticket and run the full relevant verification.
2. On the issue branch, create a complete, green review-candidate commit. It must reference the child issue (or the standalone issue) and contain the applicable AI attribution trailers.
3. Run `/code-review main` against that committed `HEAD`.
4. For a child ticket, evaluate the Spec axis against both the child's acceptance criteria and the parent spec. The child defines the unit of work; the parent preserves the feature-level intent.
5. Have reviewers report findings. The implementation agent owns changes, tests, and remediation commits.
6. Re-run relevant verification after every fix, and run `/code-review main` again after material changes.
7. Push and open the pull request only after the local review is clean. Then satisfy configured CI and human review before squash-merging.

The review-candidate commit is not permission to commit broken or partial work, and it is never made on `main`. Reassess this adapter whenever the official skills are updated rather than editing the vendored skill locally.

## Complete a parent spec

A child pull request closes its child issue, not the parent spec. After the final child merges:

1. Update local `main` and confirm every planned child is closed.
2. Re-read the parent acceptance criteria and verify the integrated behavior on `main` with the full relevant checks.
3. Comment on the parent with the verification commands and results, plus any deliberate exceptions.
4. Close the parent manually only when its acceptance criteria are met. If a gap remains, create or link a follow-up child and keep the parent open.

## Update the official skills safely

Treat skill updates as dependency updates, not as incidental edits during implementation. Run them between tickets from a clean, synchronized branch:

```sh
git status --short
npx skills@latest update --project --yes
git diff -- .agents/skills .claude/skills skills-lock.json
find -L .claude/skills -type l -print
git diff --check
```

Review every changed skill, lockfile entry, and Claude compatibility symlink before accepting the update; the `find` command should print nothing. Do not hand-edit vendored skills, silently add experimental skills, or mix a skill refresh into a product change. If the command produces no diff, there is nothing to commit. When `/implement` or `/code-review` changes upstream, reassess the committed-`HEAD` review adapter above.

## Keep stack-specific guidance current

The application scaffold and macOS CI now exist. [`README.md`](../../README.md) is the product-facing gateway; [`docs/development.md`](../../docs/development.md) owns development and verification commands, environment guidance, packaging, smoke tests, and developer troubleshooting; [`docs/architecture.md`](../../docs/architecture.md) owns the stable architecture overview; and [`docs/beta-release.md`](../../docs/beta-release.md) owns user-facing beta guidance. `package.json` and [`.github/workflows/macos-ci.yml`](../../.github/workflows/macos-ci.yml) are the executable sources for local commands and CI order, while [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md) owns the judgement-based engineering contract.

When the stack or delivery workflow changes, update the executable configuration and its owning canonical guide in the same change. Do not duplicate command matrices in agent documentation. Add preview, deployment, signing, or release policy only when the corresponding real surface exists; until then, the packaged application and its smoke test remain the preview artifact and demo evidence described in the README and [development guide](../../docs/development.md).
