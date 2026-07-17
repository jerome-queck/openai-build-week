# Matt Pocock's skills workflow, end to end

Research date: 2026-07-17

## Source and scope

The primary source is Matt Pocock's 17:17 video, [“mattpocock/skills: Learn the whole flow, end-to-end”](https://www.youtube.com/watch?v=M6mYodf0dJM), published by the [Matt Pocock channel](https://www.youtube.com/@mattpocockuk) on 2026-07-16. The recording calls itself a tutorial for the sequence, installation, and setup of the skills, but explicitly limits itself to the **main getting-started flow**, not the advanced or experimental flows ([0:00–0:32](https://www.youtube.com/watch?v=M6mYodf0dJM&t=0s)).

This study used the video's official metadata and English automatic-caption track, with on-screen frames checked where exact commands or branching logic mattered. The video description's “My Skills” link resolves to Matt's [AI Hero skills page](https://www.aihero.dev/skills), which links the [`mattpocock/skills`](https://github.com/mattpocock/skills) repository. The upstream source was also checked at commit [`9603c1c`](https://github.com/mattpocock/skills/commit/9603c1cc8118d08bc1b3bf34cf714f62178dea3b), authored about 29 minutes before the video's YouTube publication timestamp; the source links below are pinned to that observed revision.

## The workflow in one view

```text
once per repository
  install official skills
    -> setup-matt-pocock-skills
       (tracker + triage vocabulary + domain-doc layout)

for each change
  grill-with-docs
    -> unresolved question needs running code?
       yes: handoff out -> fresh prototype session -> handoff answer back
    -> fits one good context window?
       yes: implement in the same context
       no:  to-spec -> to-tickets -> clear context
            -> implement one ticket per fresh context
    -> implement drives TDD and verification
    -> two-axis code review in fresh parallel sub-agents
    -> commit current branch
```

The video's critical context rule is asymmetric: keep alignment, spec creation, and ticket slicing in one unbroken context; after tickets exist, give each implementation ticket a fresh context ([7:45–8:23](https://www.youtube.com/watch?v=M6mYodf0dJM&t=465s), [13:51–14:48](https://www.youtube.com/watch?v=M6mYodf0dJM&t=831s)). This matches the pinned [`ask-matt` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md#context-hygiene).

## Chronological reconstruction

### 1. Install the official skills

Matt runs the exact command shown on screen:

```bash
npx skills@latest add mattpocock/skills
```

It requires Node.js and invokes the skills.sh installer ([0:54–1:17](https://www.youtube.com/watch?v=M6mYodf0dJM&t=54s)); the same command is the upstream [README quickstart](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md#quickstart-30-second-setup).

In the installer he:

- Selects the official `mattpocock/skills` group and leaves the separate experimental “Other Skills” group out; he warns that the latter may be deleted ([1:28–2:18](https://www.youtube.com/watch?v=M6mYodf0dJM&t=88s)).
- Selects the agent harnesses that should receive the skills. The demo uses Claude Code, while Matt explicitly says the set supports Codex and other harnesses ([2:18–2:49](https://www.youtube.com/watch?v=M6mYodf0dJM&t=138s)).
- Chooses installation scope deliberately: **project scope for a team**, so everyone shares and can jointly change the skill set; global scope is acceptable for a solo developer ([2:50–3:17](https://www.youtube.com/watch?v=M6mYodf0dJM&t=170s)).
- Chooses the installer's recommended **symlink** mode ([3:17–3:33](https://www.youtube.com/watch?v=M6mYodf0dJM&t=197s)).

Matt's skills are mostly user-invoked and have short trigger descriptions. In his demonstrated Claude Code session, installing all the official skills added about 660 tokens of context; that number is an observation about that harness and revision, not a general budget guarantee ([3:44–4:34](https://www.youtube.com/watch?v=M6mYodf0dJM&t=224s)).

### 2. Bootstrap repository-specific configuration once

After installation, run `/setup-matt-pocock-skills` ([4:34](https://www.youtube.com/watch?v=M6mYodf0dJM&t=274s)). It configures three shared facts that downstream skills read rather than hard-coding:

1. **Issue tracker.** Specs and tickets need a durable home. The video demonstrates local Markdown, but calls out GitHub and arbitrary integrations such as Jira and Linear; the setup records the selected workflow in local configuration ([4:34–5:37](https://www.youtube.com/watch?v=M6mYodf0dJM&t=274s)). The pinned setup source adds GitLab and describes the exact adapter contract ([source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md#section-a--issue-tracker)).
2. **Triage-label vocabulary.** Matt accepts the default labels and points viewers to `/triage` for the full state model ([5:37–5:54](https://www.youtube.com/watch?v=M6mYodf0dJM&t=337s)).
3. **Domain-document layout.** Choose a single context for almost every repository; use multiple bounded contexts only for a genuinely large monorepo ([5:54–6:24](https://www.youtube.com/watch?v=M6mYodf0dJM&t=354s)).

The setup writes `docs/agents/issue-tracker.md`, `domain.md`, and, when triage is installed, `triage-labels.md`, then links them from the repository's existing `CLAUDE.md` or `AGENTS.md` ([6:24–6:52](https://www.youtube.com/watch?v=M6mYodf0dJM&t=384s), [pinned setup source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md#4-write)). The demo's local-tracker adapter stores one feature per `.scratch/<feature-slug>/`, with a PRD and individually numbered issue files visible on screen ([6:43](https://www.youtube.com/watch?v=M6mYodf0dJM&t=403s)).

### 3. Use `/ask-matt` as a router when the next flow is unclear

`/ask-matt` answers which skill or flow fits a situation; it does not perform the engineering work itself ([6:52–7:45](https://www.youtube.com/watch?v=M6mYodf0dJM&t=412s), [pinned source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md)). In the demonstration it routes an existing codebase to the top of the main flow and tells Matt to preserve one context through the alignment and decomposition phases.

### 4. Align with `/grill-with-docs`

Start a change with `/grill-with-docs`, even from a vague idea. The skill explores the codebase and asks one question at a time until user and agent have shared understanding ([8:31–9:36](https://www.youtube.com/watch?v=M6mYodf0dJM&t=511s)). The demo happened to take six questions; Matt says his sessions often take around twenty, depending on scope, so question count is not a target ([9:36–10:03](https://www.youtube.com/watch?v=M6mYodf0dJM&t=576s)).

This alignment is stateful: settled vocabulary goes into `CONTEXT.md`, while genuinely hard-to-reverse decisions can become ADRs ([7:48–8:01](https://www.youtube.com/watch?v=M6mYodf0dJM&t=468s), [pinned `grill-with-docs` documentation](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/docs/engineering/grill-with-docs.md#the-grill)). Matt runs the interview in the harness's ordinary auto mode, not a special plan mode ([10:03–10:08](https://www.youtube.com/watch?v=M6mYodf0dJM&t=603s)), and says the workflow is not tied to his demonstrated model or harness ([9:03–9:16](https://www.youtube.com/watch?v=M6mYodf0dJM&t=543s)).

### 5. Detour through a prototype only when conversation cannot settle a question

If an open question needs runnable evidence—business logic, state behaviour, or a UI that must be seen—take a prototype detour. The video identifies `/prototype` and `/handoff` as the bridge out of and back into the main thread ([8:01–8:14](https://www.youtube.com/watch?v=M6mYodf0dJM&t=481s)). The pinned router source makes the boundary explicit: hand off from the idea thread, open a fresh prototype session, capture the answer, then hand the learned result back to the original thread ([source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md#the-main-flow-idea--ship)). Prototype code is disposable evidence, not production code ([pinned `prototype` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/prototype/SKILL.md)).

### 6. Branch on whether implementation fits one healthy context window

After alignment, decide whether the build is one sitting or multiple sessions ([10:08](https://www.youtube.com/watch?v=M6mYodf0dJM&t=608s)):

- **One sitting:** invoke `/implement` immediately in the same context. Do not manufacture a spec and tickets for work that comfortably fits ([10:08–11:03](https://www.youtube.com/watch?v=M6mYodf0dJM&t=608s)).
- **Multiple sessions, or alignment has consumed too much context:** persist the shared understanding with `/to-spec`, then `/to-tickets` ([11:03–11:23](https://www.youtube.com/watch?v=M6mYodf0dJM&t=663s)).

Matt verbally treats roughly 140k tokens as his personal “smart zone” ceiling in this demo, while the rendered `/ask-matt` answer and pinned source use roughly 120k as a conservative state-of-the-art-model guideline ([10:28–10:58](https://www.youtube.com/watch?v=M6mYodf0dJM&t=628s), [pinned context-hygiene source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md#context-hygiene)). These are heuristics for detecting degraded reasoning, not a universal hard limit.

### 7. For multi-session work, `/to-spec` preserves the destination

Run `/to-spec` in the **same alignment session**. In the demo it compresses the preceding 46.1k-token discussion into a durable artifact in the configured tracker ([11:18–11:43](https://www.youtube.com/watch?v=M6mYodf0dJM&t=678s)). Matt distinguishes the artifacts this way: the spec describes the end state; tickets describe the route to it ([11:43–11:58](https://www.youtube.com/watch?v=M6mYodf0dJM&t=703s)).

The demonstrated spec contains a problem statement, solution, user stories, implementation decisions, and testing decisions, and later serves as the acceptance baseline for final review ([11:58–12:20](https://www.youtube.com/watch?v=M6mYodf0dJM&t=718s)). The pinned source adds out-of-scope items and requires testing seams to be agreed before publication ([`to-spec` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-spec/SKILL.md)).

### 8. Still in that session, `/to-tickets` turns the destination into context-sized slices

Immediately run `/to-tickets` without changing sessions ([12:20–12:31](https://www.youtube.com/watch?v=M6mYodf0dJM&t=740s)). Each ticket should fit one fresh context or “smart zone.” The human remains responsible for the granularity: when the demo proposes three tickets, Matt judges the work small enough and asks for one instead ([12:31–12:56](https://www.youtube.com/watch?v=M6mYodf0dJM&t=751s)). His real example shows an eleven-ticket spec, each ticket describing what one session should build ([13:04–13:51](https://www.youtube.com/watch?v=M6mYodf0dJM&t=784s)).

The pinned skill source defines the stronger decomposition contract: tickets are independently verifiable **vertical tracer-bullet slices**, each declaring blocking edges; work any ticket on the current unblocked frontier ([`to-tickets` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-tickets/SKILL.md)).

### 9. Clear context, then `/implement` one ticket at a time

Only after the spec and tickets exist does Matt clear the conversation and start implementation from the ticket artifact ([13:51–14:22](https://www.youtube.com/watch?v=M6mYodf0dJM&t=831s)). Work tickets one by one. If substantial healthy context remains, the next ticket might fit; his default is nevertheless to clear between tickets ([14:22–14:48](https://www.youtube.com/watch?v=M6mYodf0dJM&t=862s)).

`/implement` is execution, not another planning phase. It drives TDD at pre-agreed seams, typechecks and runs focused tests during the work, runs the full suite at the end, then reviews and commits ([pinned `implement` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/implement/SKILL.md)). In the video, the agent runs the repository's typecheck, build, tests, and a product-specific CLI-help verification before review ([14:55–15:12](https://www.youtube.com/watch?v=M6mYodf0dJM&t=895s)).

### 10. `/implement` closes with independent two-axis review, then commits

The implement flow automatically loads `/code-review` before committing ([14:48–15:12](https://www.youtube.com/watch?v=M6mYodf0dJM&t=888s)). Review has two independent axes:

- **Spec:** compare the completed diff against every requirement in the originating spec.
- **Standards:** compare the diff against repository coding standards, falling back to a Fowler code-smell baseline when the repository documents none.

Matt runs these as separate fresh sub-agents so the code's authoring context does not bias its own review ([15:12–16:10](https://www.youtube.com/watch?v=M6mYodf0dJM&t=912s)). The pinned [`code-review` source](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/code-review/SKILL.md) further requires a fixed-point diff and keeps the two reports separate rather than blending their verdicts. After both axes pass in the demo, `/implement` commits to the current branch ([16:10–16:23](https://www.youtube.com/watch?v=M6mYodf0dJM&t=970s)).

The recording stops at a successful commit. It does **not** demonstrate branch creation, push, pull request, CI, deployment, or post-deployment verification, despite the upstream router naming the flow “idea → ship” ([16:23–16:40](https://www.youtube.com/watch?v=M6mYodf0dJM&t=983s)). Those remain repository-specific outer-loop concerns rather than evidence from this video.

## Named skills and primary sources

| Skill                      | Role in the video                                            | Pinned source                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-matt-pocock-skills` | One-time tracker, label, and domain-doc configuration        | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md) |
| `ask-matt`                 | User-invoked router over flows                               | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md)                 |
| `grill-with-docs`          | Stateful alignment interview                                 | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/grill-with-docs/SKILL.md)          |
| `handoff`                  | Bridge into and out of a fresh session                       | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/productivity/handoff/SKILL.md)                 |
| `prototype`                | Runnable answer to one unresolved design question            | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/prototype/SKILL.md)                |
| `to-spec`                  | Persist aligned end state                                    | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-spec/SKILL.md)                  |
| `to-tickets`               | Decompose into context-sized, blocked vertical slices        | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-tickets/SKILL.md)               |
| `implement`                | Execute a spec/ticket, drive verification and review, commit | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/implement/SKILL.md)                |
| `tdd`                      | Test-first implementation primitive driven by `implement`    | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/tdd/SKILL.md)                      |
| `code-review`              | Parallel Standards and Spec review before commit             | [SKILL.md](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/code-review/SKILL.md)              |

## Workflow invariants evidenced by the video

These are the points a repository adaptation should preserve:

1. **Configuration is repository data.** Tracker, labels, and domain-doc locations are written once and read by every downstream skill.
2. **Alignment precedes implementation.** The first durable output is shared vocabulary and, only when warranted, ADRs—not code.
3. **Runnable uncertainty gets its own disposable experiment.** Use handoffs to keep prototype context from contaminating the idea thread.
4. **Spec and tickets are conditional.** A small change goes directly from alignment to implementation; multi-session work earns the extra artifacts.
5. **Decomposition is bounded by reasoning quality, not line count.** Each ticket must fit a fresh context, and the user can merge or split the agent's proposal.
6. **Artifacts provide continuity; fresh contexts provide attention.** Preserve one thread through `/to-tickets`, then reset between implementation tickets.
7. **Verification is both executable and semantic.** Tests/typechecks establish that the code runs; independent Standards and Spec reviews establish that it is well-built and is the requested thing.
8. **The spec remains live through review.** It is not planning exhaust; it is the final acceptance baseline.
9. **The demonstrated inner loop ends at commit.** Branching, PR review, CI, deployment, and production validation need an explicit repository-specific outer loop if they matter.

## Skill update result for this repository

The repository has 22 project-scoped skills from `mattpocock/skills` in `.agents/skills/`, with Claude Code symlinks in `.claude/skills/` and provenance recorded in `skills-lock.json`. Running the project updater on 2026-07-17 produced no tracked diff because all 22 installed skills already matched upstream commit [`9603c1c`](https://github.com/mattpocock/skills/commit/9603c1cc8118d08bc1b3bf34cf714f62178dea3b).

The only upstream additions since the previous project sync are two explicitly in-progress skills: [`to-questionnaire`](https://github.com/mattpocock/skills/pull/572) and [`batch-grill-me`](https://github.com/mattpocock/skills/pull/586). They are not updates to the installed official set, and the video specifically recommends selecting the official group while leaving experimental “Other Skills” unselected. Neither should be added to this team repository by default. `batch-grill-me` may be worth a deliberate trial later, but it does not update the domain docs and is not routed by `/ask-matt`, so it is not a drop-in replacement for `/grill-with-docs`.

## Repository adaptation

This is a dated research record, not the repository's policy source. The adopted workflow is deliberately layered:

- [`AGENTS.md`](../../AGENTS.md) stays a lean agent entrypoint: repository configuration, the hackathon reference, attribution, and pointers to canonical instructions.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) defines the concise team policy for tracking work, branches, commits, pull requests, and attribution.
- [`docs/agents/engineering-workflow.md`](../agents/engineering-workflow.md) contains the detailed Matt-flow routing, implementation start gate, TDD loop, committed-diff review adapter, and parent-spec completion procedure.
- [`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) owns GitHub-specific tracker, dependency, frontier, and claim mechanics.

If this research note and those files ever disagree, the layered policy above wins.

### Current repository decisions

- The project-scoped install, shared lockfile, and Claude symlinks match Matt's team recommendation.
- GitHub Issues, the five canonical triage labels, and the single-context domain-doc adapter are configured in [`docs/agents/`](../agents/).
- `/triage` remains limited to incoming requests; `/to-spec` and `/to-tickets` already create agent-ready work.
- The repository preserves one alignment context through `/to-tickets`, then uses a fresh `/implement` context for each unblocked child ticket.
- Because the installed `/code-review` reviews committed `HEAD`, implementation uses a verified local review commit before `/code-review main`, then remediates and re-reviews material fixes before publication. This adapter remains temporary while [mattpocock/skills#511](https://github.com/mattpocock/skills/issues/511) is unresolved.
- [`.github/pull_request_template.md`](../../.github/pull_request_template.md) captures the Issue, optional parent spec, verification results, review outcome, demo evidence, and final squash-attribution reminder.
- GitHub is configured for squash merging only and automatic deletion of merged branches, matching the documented outer loop.
- The root `CONTEXT.md` and ADRs now capture the domain language and decisions earned through product grilling; future additions remain lazy and evidence-driven.

### Safe skill maintenance

Update only the installed project-scoped set, then review the dependency change:

```bash
git status --short
npx skills@latest update --project --yes
git diff -- .agents/skills .claude/skills skills-lock.json
find -L .claude/skills -type l -print
git diff --check
```

The `find` command should print nothing. Do not hand-edit vendored files under `.agents/skills/` for repository policy, and do not silently add experimental skills during an update. Recheck whether repository compatibility rules—especially the committed-diff review adapter—are still necessary after each update.

### Deferred until the application scaffold exists

- Record the application's real focused-test, full-test, typecheck, build, and end-to-end smoke commands. Do not invent generic placeholders.
- Add CI that runs those commands, then protect `main` with the resulting required checks.
- Expand the placeholder README with setup, run, sample-data, judge-access, and Codex/GPT-5.6 collaboration instructions required by [`docs/openai-build-week.md`](../openai-build-week.md).

### Keep advanced flows optional

The video deliberately excludes advanced workflows. The GitHub adapter documents Wayfinder mechanics, but its extra labels should be created only if the team deliberately adopts `/wayfinder`; it is not part of the main getting-started loop.
