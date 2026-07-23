# Contributing

## Work tracking

- Use one GitHub Issue per independently deliverable feature, fix, or maintenance task.
- Explicitly run `/triage` only for incoming Issues you did not create. It turns raw requests into agent-ready briefs.
- Issues created by `/to-spec` or `/to-tickets` are already `ready-for-agent`; do not send them through `/triage`.
- When a spec is split into child tickets, treat the parent Issue as the planning index and each unblocked child as the unit of implementation.
- Keep one active implementer per Issue. Follow the claim and entry checks in the [engineering workflow](docs/agents/engineering-workflow.md) and [issue-tracker guide](docs/agents/issue-tracker.md).
- For tracked work, reference the ticket as `Refs #<number>` in at least one branch commit and `Closes #<number>` in the pull request.

## Documentation ownership

Keep each kind of repository guidance in its canonical home and link to it instead of copying a second command matrix or architecture description:

- [`README.md`](README.md) is the product-facing gateway for identity, capabilities, beta status, trust, accessibility, and feedback.
- [`docs/development.md`](docs/development.md) owns supported development setup, commands, verification, packaging, smoke testing, and developer troubleshooting.
- [`docs/architecture.md`](docs/architecture.md) owns stable runtime responsibilities, public engineering seams, persistence, and trust boundaries.
- [`docs/beta-release.md`](docs/beta-release.md) owns user-facing beta installation limitations, privacy, recovery, and feedback guidance.
- [`evaluation/README.md`](evaluation/README.md) owns candidate evidence and learning-evaluation procedures.
- `package.json` and [macOS CI](.github/workflows/macos-ci.yml) are the executable sources for scripts and hosted verification order.

Update the owning document in the same pull request when a change affects its contract. The pull-request template records the documentation-impact decision; a change that affects more than one owner should link the related sections rather than restating them.

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

When an AI agent materially contributes, include its model-specific co-author and session trailers exactly once in local commits and in the final squash-commit message.

Codex uses its current model display name and thread ID:

```text
Co-authored-by: Codex <model> <noreply@openai.com>
Codex-Session: codex://threads/<CODEX_THREAD_ID>
Codex-Feedback-Session: <CODEX_THREAD_ID>
```

`Codex-Feedback-Session` is the raw ID required by the OpenAI Build Week Devpost form's `/feedback` field. It must match the ID embedded in `Codex-Session`; include each trailer exactly once.

Claude Code's generated model-specific `Co-authored-by` and `Claude-Session` trailers should be preserved. Do not invent session identifiers, duplicate automatic trailers, or attribute an agent that did not materially contribute.

## Pull requests

- Keep the pull request focused on its ticket.
- Include `Closes #<issue-number>` in the body and target `main` so GitHub closes the Issue on merge.
- Explain the change and list verification performed.
- If `main` advances, update the branch, resolve conflicts, then rerun affected tests and review.
- Squash-merge, ensure the squash-commit message contains each applicable AI attribution trailer exactly once, then delete the branch.

Trivial repository setup or documentation corrections may go directly to `main`. This exception never applies to tracked product `/implement` work.
