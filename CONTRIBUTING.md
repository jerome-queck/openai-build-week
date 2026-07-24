# Contributing

## Work tracking

- Use one GitHub Issue per independently deliverable feature, fix, or maintenance task.
- Explicitly run `/triage` only for incoming Issues you did not create. It turns raw requests into agent-ready briefs.
- Issues created by `/to-spec` or `/to-tickets` are already `ready-for-agent`; do not send them through `/triage`.
- When a spec is split into child tickets, treat the parent Issue as the planning index and each unblocked child as the unit of implementation.
- Keep one active implementer per Issue. Follow the claim and entry checks in the [engineering workflow](docs/agents/engineering-workflow.md) and [issue-tracker guide](docs/agents/issue-tracker.md).
- For tracked work, reference the ticket as `Refs #<number>` in at least one branch commit and `Closes #<number>` in the pull request.

## Current participation and intellectual property boundary

Public product feedback, proposals, accessibility reports, mathematical
accuracy concerns, and security reports are welcome through their documented
channels. Read the [security policy](SECURITY.md), [privacy notice](PRIVACY.md),
and [Code of Conduct](CODE_OF_CONDUCT.md) before using those channels. During
the source-available development phase, Clarifold does not
accept outside code, design, icon, documentation, or substantial
mathematical-content contributions. Opening a pull request or offering a
change under the repository's outbound license does not grant a contributor
rights or create an obligation to merge it.

Before the first collaborative contribution is accepted, Jerome Queck must
classify the contributor relationship, decide whether ownership remains with
him or moves to a Singapore entity, and put written Singapore-appropriate
terms in place. Those terms must address copyright ownership or a sufficiently
broad irrevocable and sublicensable commercial license, patent questions,
trademark and brand permissions, and preserved attribution. Assignment is
preferred when retaining a single owner is the priority. A DCO sign-off alone
does not transfer ownership, and a commercial software permission does not
automatically permit use of the Clarifold brand.

This is an intentional future collaboration gate, not a draft contributor
agreement. Professional legal review is deferred until collaboration is
imminent or another legal-review trigger is reached; the gate cannot be
repaired after accepting the contribution.

## Documentation ownership

Keep each kind of repository guidance in its canonical home and link to it instead of copying a second command matrix or architecture description:

- [`README.md`](README.md) is the product-facing gateway for identity, capabilities, beta status, trust, accessibility, and feedback.
- [`docs/development.md`](docs/development.md) owns supported development setup, commands, verification, packaging, smoke testing, and developer troubleshooting.
- [`docs/architecture.md`](docs/architecture.md) owns stable runtime responsibilities, public engineering seams, persistence, and trust boundaries.
- [`docs/beta-release.md`](docs/beta-release.md) owns user-facing beta installation limitations, privacy, recovery, and feedback guidance.
- [`evaluation/README.md`](evaluation/README.md) owns candidate evidence and learning-evaluation procedures.
- `package.json` and [macOS CI](.github/workflows/macos-ci.yml) are the executable sources for scripts and hosted verification order.

Update the owning document in the same pull request when a change affects its contract. A change that affects more than one owner should link the related sections rather than restating them. Migration, persisted-schema, data-directory, and recovery changes update `docs/development.md` and, when user-facing, `docs/beta-release.md`; architecture or provenance consequences update `docs/architecture.md`. Every material pull request must complete the documentation-impact and security-impact declarations in the pull-request template, with an explanation for either outcome. The repository policy checks validate these declarations, canonical documents, local links and anchors, documented npm commands, and fail-closed changed-path classification.

## Branches

Keep `main` stable and demo-ready. Create each branch from an up-to-date `main`:

```text
feature/12-streaming-chat
fix/19-login-error
docs/23-api-guide
chore/27-update-tooling
```

Default to one branch and one pull request per ticket. Do not mix unrelated work, branch from unfinished feature branches, or reuse merged branches. Merge blockers before dependants. Never run tracked product `/implement` work directly on `main`.

Prototypes are different: capture them on a clearly named throwaway branch outside `main`, link that branch and its verdict from the Issue, and merge only the validated decision into production code.

## Implementation

- Follow the repository-wide [coding standards](CODING_STANDARDS.md). They define the judgement-based architecture, data, trust-boundary, accessibility, and testing rules used during review.
- Test observable behavior at an agreed public seam. For agent-driven product work, follow the installed `/tdd` workflow.
- Work one vertical red-green slice at a time: establish a meaningful failure, add only enough behavior to pass, then begin the next slice.
- After the ticket's intended behavior is green, address structural cleanup during review remediation while keeping the behavior tests passing.
- Keep every commit focused and leave tests passing.
- Use conventional commit subjects where practical, such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, or `chore:`.
- Run typechecking and focused tests regularly; run the full suite at completion.
- Treat documentation, security, and verification-policy changes as part of the same tracked change; do not defer an affected canonical document or security review declaration to a cleanup issue.
- For bug fixes, state the confirmed cause in the commit or pull-request message.

### Review ordering

For product work, use this flow:

1. Claim the Issue and create its branch from an up-to-date `main`.
2. Implement and verify the work on that branch.
3. Create a complete, green local review commit containing `Refs #<number>` and all applicable AI-attribution trailers.
4. Run `/code-review main` using the repository adapter in the [engineering workflow](docs/agents/engineering-workflow.md). Use [CODING_STANDARDS.md](CODING_STANDARDS.md) as the primary Standards source, and review against both the child ticket and its parent spec when both exist.
5. Remediate findings on the same branch, retest, and commit the fixes. Rerun review after material changes.
6. Push the branch and open a pull request targeting `main`.
7. Pass configured CI and any required human review.
8. Squash-merge only after review and tests pass. This is the step that changes `main` and can close the linked Issue.

## AI attribution

When an AI agent materially contributes, disclose that assistance in the commit and pull request while keeping the human maintainer or approved collaborator as the commit author and accountable reviewer. Use the neutral `Assisted-by` convention and include an authentic session reference when one is available.

Codex uses its current model display name and thread ID:

```text
Assisted-by: Codex <model>
Codex-Session: codex://threads/<CODEX_THREAD_ID>
```

The session reference must be genuine, must match the current work, and must appear at most once. Never invent a session identifier. AI provenance does not replace source and dependency review, security triage, tests, mathematical review, documentation-impact declarations, or protected-branch controls.

Equivalent authentic provenance may be retained for other agents, but AI systems do not receive `Co-authored-by` trailers. Human contributors review generated content for copied material, licence incompatibility, sensitive data, unsafe behavior, and truthful attribution.

## Git identity

Use a stable name and an email address you control for new commits. The maintainer's canonical repository identity is:

```sh
git config user.name "Jerome Queck"
git config user.email "jeromequeck@jeromegroup.org"
```

Check the effective identity before committing with `git config --show-origin --get-regexp '^user\\.(name|email)$'`. The repository [`.mailmap`](.mailmap) maps Jerome's historical NTU address for display without rewriting public history. Do not commit credentials, private keys, learner data, or machine-local paths.

## Pull requests

- Keep the pull request focused on its ticket.
- Include `Closes #<issue-number>` in the body and target `main` so GitHub closes the Issue on merge.
- Explain the change and list verification performed.
- If `main` advances, update the branch, resolve conflicts, then rerun affected tests and review.
- Squash-merge, ensure the squash-commit message contains each applicable AI attribution trailer exactly once, then delete the branch.

Trivial repository setup or documentation corrections may go directly to `main`. This exception never applies to tracked product `/implement` work.
