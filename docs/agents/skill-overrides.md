# Local skill overrides

The skills under `.agents/skills/` are vendored and updated manually. Do not run blind skill updates; compare upstream changes and preserve the overrides below.

## `code-review`: pre-commit working-state review

Upstream `code-review` uses `git diff <fixed-point>...HEAD`, which excludes staged, unstaged, and untracked work. That conflicts with Matt's intended `implement → code-review → commit` order.

The local skill instead:

- resolves the merge base between the fixed point and `HEAD`;
- diffs that merge base against the working tree, including committed, staged, and unstaged tracked changes;
- lists and reads untracked files separately;
- permits an empty commit list during pre-commit review.
- finds the spec before the first commit from the current conversation or the Issue number in the branch name.

Background and primary-source evidence: [`docs/research/matt-skills-review-commit-order.md`](../research/matt-skills-review-commit-order.md).

When manually updating from `mattpocock/skills`, retain this override until upstream issue [#511](https://github.com/mattpocock/skills/issues/511) is resolved and the installed upstream behavior is verified.
