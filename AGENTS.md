## Agent skills

### Issue tracker

GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

## Commit attribution

When materially involved, ensure the commit message includes each applicable trailer exactly once:

```text
Co-authored-by: Codex <noreply@openai.com>
Co-authored-by: Claude <noreply@anthropic.com>
```

Follow `CONTRIBUTING.md` for branches, commits, and pull requests.

Automatically use only model-invocable skills when their trigger descriptions match. Never auto-invoke a skill marked `disable-model-invocation: true`; use it only when explicitly requested. When the user explicitly asks which flow fits, use `/ask-matt`.
