# Public documentation maintenance audit

## Question

Can Clarifold make its README product-first by moving detailed development, verification, and architecture material into dedicated documents without making the Matt-based engineering workflow prone to documentation drift?

## Current contracts

- `README.md` currently owns human-facing requirements, development and verification commands, environment guidance, packaging, demo evidence, and the architecture overview.
- `docs/agents/engineering-workflow.md` explicitly requires stack or delivery changes to update executable configuration and README guidance together.
- `CODING_STANDARDS.md` links to the README for the architecture boundary and verification command set.
- `CONTRIBUTING.md` combines human contribution guidance with the repository's issue, branch, review, pull-request, and AI-attribution workflow.
- `AGENTS.md` already requires agents to read the engineering workflow and coding standards before tracked product work, and to follow `CONTRIBUTING.md` for branches, commits, and pull requests.

The installed Matt skills do not independently maintain this documentation architecture:

- `/implement` implements the ticket, uses TDD where possible, verifies, invokes code review, and commits. It contains no general documentation-impact step.
- `/to-spec` can preserve documentation decisions under its implementation and testing decisions, but only when those decisions are explicit in the planning context.
- `/to-tickets` turns the approved spec into independently verifiable slices; it does not infer a repository-wide documentation migration that the spec omitted.
- `/code-review` checks the diff against repository standards and the originating spec. It can catch documentation drift only when the relevant ownership and update rules are present in those sources.

## Verdict

A product-first README split is appropriate, but it must be implemented as a coordinated documentation-authority migration rather than a prose move. The repository adapter and review contract—not hand-edits to vendored Matt skills—should make the new ownership durable.

`AGENTS.md` does not need a detailed command or document matrix. Its existing pointers are sufficient if the engineering workflow and coding standards state the new canonical ownership precisely. Keeping the root agent entrypoint lean also reduces conflicts when installed skills are refreshed.

## Proposed authority after migration

- **README:** product identity, problem, audience, capabilities, screenshots, user installation, beta limitations, trust boundaries, license, and a short developer gateway.
- **Development guide:** supported development environment, setup, commands, native and verifier preparation, focused and full verification, packaging, smoke testing, and developer troubleshooting.
- **Architecture guide:** stable system responsibilities and component boundaries needed by human developers; domain language and hard decisions remain in `CONTEXT.md` and ADRs.
- **CONTRIBUTING:** public participation policy first, including that feedback and reports are welcome while outside code contributions are not currently accepted; approved-maintainer workflow and AI attribution remain available without presenting unsolicited pull requests as welcome.
- **CODING_STANDARDS:** judgement-based engineering and review contract, including documentation-impact duties where a change affects public behavior, setup, commands, packaging, architecture, licensing, or contribution policy.
- **Engineering workflow:** repository-specific adapter telling `/implement` agents which canonical human document changes with each class of product or stack change.
- **Executable sources:** `package.json` owns runnable scripts and the macOS CI workflow owns hosted verification order. Human documents explain those sources without duplicating their implementation.

## Drift controls required by the eventual spec

1. Migrate all inbound references from README architecture and verification anchors to their new canonical destinations in the same change.
2. Add an explicit documentation-impact check to the pull-request template and repository review contract.
3. Require tracked implementation work to update the owning human document whenever it changes public behavior, supported setup, a command, packaging, release evidence, architecture responsibilities, licensing, or participation policy.
4. Add a lightweight automated documentation check that at minimum rejects broken local Markdown links and documented `npm run` commands that do not exist in `package.json`.
5. Keep each fact in one authoritative human document; use links rather than repeating the complete command matrix or architecture description.
6. Make the public contribution boundary agree across README, `CONTRIBUTING.md`, issue forms, and pull-request surfaces.
7. Preserve the exact `## Agent skills` setup anchor and do not hand-edit installed Matt skill files; skill refreshes remain reviewed dependency updates.
8. Include documentation routing and drift controls explicitly in the parent spec and in the acceptance criteria of every child whose behavior changes a canonical document.
9. Verify the integrated result on `main`, including links, documented commands, repository community-health files, packaging references, and the full relevant project verification.
10. Add a pull-request security-impact declaration and route scanner findings through explicit security triage, targeted remediation, security diff scan, ordinary code review, protected CI, and evidence-backed closure; Dependabot PRs never auto-merge.

## Spec consequence

The public-repository and Clarifold rebrand work is multi-session. Its future parent spec must treat documentation ownership, workflow adaptation, automated drift checks, contribution boundaries, licensing, naming, icon review, packaging metadata, and GitHub repository settings as one coordinated outcome. Ticketing should create an early documentation-authority migration that unblocks later product, licensing, community-health, and branding slices; no ticket may independently create a second command matrix or architecture source.
