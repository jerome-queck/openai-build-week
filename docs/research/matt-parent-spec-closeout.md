# Matt parent-spec closeout after the final child

**Question:** After `/to-spec` creates a parent spec and `/to-tickets` decomposes it into children, should the completed parent receive another `/implement` after the final child, or should it receive a non-implementation closeout?

**Conclusion:** Do **not** run `/implement` on the decomposed parent merely because its last child finished. Matt's upstream flow explicitly directs `/implement` at **each ticket**, one ticket per fresh context, and tells `/to-tickets` not to close or modify the parent. Upstream does not define a post-final-child parent-closeout skill or procedure. Therefore, “audit the integrated result against the parent, then close the parent without another implementation pass” is the sound inference; the exact audit/comment/close steps are this repository's adapter, not an explicit upstream Matt procedure.

## Primary-source findings

The installed skills identify `mattpocock/skills` as their GitHub source in [`skills-lock.json`](../../skills-lock.json). On 2026-07-21, upstream `main` resolved to immutable commit [`9603c1cc8118d08bc1b3bf34cf714f62178dea3b`](https://github.com/mattpocock/skills/commit/9603c1cc8118d08bc1b3bf34cf714f62178dea3b); the installed `ask-matt`, `to-spec`, `to-tickets`, `implement`, and `code-review` files matched the corresponding files at that revision byte-for-byte.

### What upstream says explicitly

- [`ask-matt`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/ask-matt/SKILL.md#the-main-flow-idea--ship) routes a multi-session build through `/to-spec`, then `/to-tickets`, after which agents “kick off `/implement` per ticket, clearing context between each one.” It separately says that `/implement` “builds each issue.”
- [`to-tickets`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-tickets/SKILL.md#5-publish-the-tickets-to-the-configured-tracker) publishes independently verifiable children, says to work the unblocked frontier “one ticket at a time with `/implement`,” and explicitly says: “Do NOT close or modify any parent issue.” Its [upstream documentation](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/docs/engineering/to-tickets.md#where-it-fits) repeats “one ticket per fresh context.”
- [`implement`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/implement/SKILL.md) is a code-producing procedure: TDD, typechecking, focused and full tests, review, and a commit. Its [upstream documentation](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/docs/engineering/implement.md#where-it-fits) places it after ticket sequencing and says it works through the tickets produced by `/to-tickets`.
- [`code-review`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/code-review/SKILL.md#2-identify-the-spec-source) uses the originating issue, PRD, or spec as the semantic review baseline for a code diff. That keeps the parent spec relevant during child implementation, but it does not prescribe a second parent `/implement` after all child diffs have landed.

### What upstream does not say

No examined canonical skill defines what happens to a parent issue after its final child completes. In particular, upstream does not provide an instruction to re-run `/implement` on the parent, nor an official parent audit/comment/close sequence. The earlier end-to-end study already identifies this boundary: Matt's demonstrated inner loop ends at a successful ticket commit; pull requests, CI, and later tracker lifecycle are outside that demonstrated upstream loop ([existing research](matt-pocock-skills-end-to-end-workflow.md#10-implement-closes-with-independent-two-axis-review-then-commits)).

## Inference and repository adapter

Running `/implement` again on a fully decomposed parent would duplicate the child execution phase and would have no new bounded implementation unit. That conclusion is an **inference from the upstream routing and parent-protection rules**, not a quoted upstream closeout rule.

This repository makes the missing outer lifecycle explicit in [`docs/agents/engineering-workflow.md`](../agents/engineering-workflow.md#complete-a-parent-spec): never implement a decomposed parent; after the final child merges, synchronize `main`, confirm all children are closed, verify the integrated behavior against the parent acceptance criteria, comment with evidence and exceptions, then close the parent only if it passes. If a gap remains, create or link a focused follow-up child and keep the parent open.

For issue #2, the intended next action under the repository's adopted Matt flow is therefore **parent-spec closeout**, not `/implement #2`.
