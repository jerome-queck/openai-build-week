## Agent skills

## Hackathon reference

For OpenAI Build Week requirements, tracks, deadlines, required deliverables, form fields, and judging, read [`docs/openai-build-week.md`](docs/openai-build-week.md) before planning or preparing a submission. Consult the live [Official Rules](https://openai.devpost.com/rules) for rules, eligibility, intellectual-property terms, and prizes.

### Issue tracker

GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

## Commit attribution

When materially involved, ensure the commit message includes each applicable agent's model-specific co-author and session trailers exactly once.

For Codex, use the current model display name and `CODEX_THREAD_ID`:

```text
Co-authored-by: Codex <model> <noreply@openai.com>
Codex-Session: codex://threads/<CODEX_THREAD_ID>
Codex-Feedback-Session: <CODEX_THREAD_ID>
```

`Codex-Feedback-Session` is the raw thread ID required by the OpenAI Build Week Devpost form's `/feedback` field. It must exactly match the ID embedded in `Codex-Session`; include each trailer once in every Codex-attributed commit.

For Claude, preserve Claude Code's generated model-specific `Co-authored-by` and `Claude-Session` trailers. Never invent a session identifier or duplicate an automatic trailer.

Follow `CONTRIBUTING.md` for branches, commits, and pull requests.

Automatically use only model-invocable skills when their trigger descriptions match. Never auto-invoke a skill marked `disable-model-invocation: true`; use it only when explicitly requested. When the user explicitly asks which flow fits, use `/ask-matt`.
