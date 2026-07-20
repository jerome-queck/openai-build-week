# Failure-recovery procedures v1

Run the full deterministic suite with `npm test`, then retain the named test output and the packaged smoke result with the release evidence. A scenario passes only when its named observable behavior passes; editing persisted JSON or fabricating state outside the public boundary is not evidence.

| Scenario | Required observable test evidence |
| --- | --- |
| `recovery-runtime-loss` | `launches into an honest authentication failure instead of hanging when Codex is unavailable` and `surfaces honest runtime failures and retries the same Teaching Card` |
| `recovery-interrupted-agent-work` | `checkpoints an unfinished Agent Task on quit and resumes it only after an explicit learner action` plus the packaged Background Agent Task journey |
| `recovery-stale-source` | `creates a visible Source Revision, rebuilds its Source Index, and never snapshots a change automatically` |
| `recovery-reanchoring-uncertainty` | `keeps uncertain and missing matches unresolved until the learner confirms a replacement, across relaunch` |
| `recovery-privacy-denial` | `denies app-server approval requests under Focused Access` and `supplies only authorized source content to the Model Runtime` |
| `recovery-verifier-failure` | `reports an unavailable checker` and the packaged remove/unavailable/reinstall journey |
| `recovery-verifier-upgrade` | `reports and cleans interrupted staging without activating a half-installed checker` and `keeps a failed validation in inactive staging for explicit cleanup` |
| `recovery-artifact-invalidation` | `stales only the exact changed claim in a multi-claim Artifact revision` and `invalidates a claim when regeneration changes assumptions without changing its displayed statement` |
| `recovery-critical-journey-accessibility` | Renderer tests covering labelled keyboard controls, visible pending/error states and focus restoration, plus `npm run test:smoke` |

Record failures honestly even if a retry later passes. Any observed release-blocker class must be copied into the trial's `observedBlockers` array and cannot be waived by an exception.
