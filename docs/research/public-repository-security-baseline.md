# Public repository security baseline audit

## Controls applied on 2026-07-21

- GitHub Private Vulnerability Reporting: enabled.
- Dependabot alerts and automatic security updates: enabled.
- Secret scanning and repository push protection: enabled.
- CodeQL default setup: configured weekly for Actions and JavaScript/TypeScript with remote and local sources considered.
- `main`: pull request required, strict `verify` required, linear history and resolved conversations required, force-pushes and deletion blocked, zero approval count, administrator emergency bypass retained.
- `.github/dependabot.yml`: locally added for grouped monthly npm and GitHub Actions version/security update proposals; inactive until merged.

## Initial findings

Secret scanning reported zero alerts.

Dependabot reported unresolved development-dependency advisories with patched versions available. Parent issue #81 retains the dated aggregate intake snapshot already published during planning; the current inventory and affected packages remain in the private triage record. Enabling automated updates does not itself prove that a generated dependency change is compatible; each proposed lockfile or dependency update still requires the normal verification lane.

CodeQL reported unresolved critical, high, and medium alerts across command construction, filesystem paths, dynamic dispatch, and workflow permissions. Parent issue #81 retains the dated aggregate intake snapshot already published during planning; the current per-alert inventory, locations, source-to-sink hypotheses, and validation results remain in the private triage record. These are static-analysis findings awaiting validation, not confirmed exploitable vulnerabilities. Triage must trace each input source, trust boundary, normalization/allowlist, filesystem root, command invocation, and packaged reachability. Valid findings require a tested fix; false positives require a specific GitHub dismissal reason and evidence rather than blanket suppression.

## Required remediation workstream

Before the Clarifold public cutover, a dedicated security change must:

1. Add least-privilege workflow permissions immediately and verify pull-request behavior.
2. Resolve patched development-dependency advisories through reviewed updates and the full verification lane.
3. Independently triage every command-construction finding against its actual trust boundary and packaged reachability before classifying or dismissing it.
4. Classify path alerts by boundary: learner-controlled paths, environment/test controls, persisted paths, packaged resources, and fixed internal paths.
5. Add or strengthen path containment, canonicalization, identifier validation, symlink handling, and command allowlisting where findings are valid.
6. Dismiss only demonstrably false-positive or test-only findings with individual evidence in GitHub.
7. Replace the failed Swift default autobuild with a deliberate custom Swift analysis path or an explicitly documented equivalent security review; do not leave a permanently failing CodeQL job.
8. Rerun CodeQL, dependency alerts, secret scanning, unit/integration tests, packaged smoke, and relevant adversarial tests on the final candidate.
9. Decide the merge gate after triage: at minimum no unresolved critical or high finding accepted without an explicit, time-bounded risk decision by Jerome Queck.

## Durable delivery route

GitHub scanners and Dependabot provide intake, not unattended remediation. Every finding follows:

1. Import the relevant GitHub scanner or advisory finding into `codex-security:triage-finding` and preserve its GitHub provenance.
2. Classify it with evidence before creating implementation work. Keep sensitive confirmed details in a private draft security advisory; a public issue may carry only disclosure-safe work.
3. Use `codex-security:fix-finding` for a targeted validated or plausible finding, or `/implement` only after an approved ticket captures the same security acceptance criteria. `/implement` does not replace triage.
4. Require a focused reproducer or regression test, the full repository verification lane, and `codex-security:security-diff-scan` in addition to the ordinary `/code-review` for security-sensitive diffs.
5. Merge only through protected `main`; Dependabot PRs never auto-merge.
6. Close or dismiss the originating alert or advisory only after the merged revision and verification evidence are read back. False-positive dismissal requires individual reasoning.

The implementation must add a security-impact declaration to the pull-request template and encode this route in `docs/agents/engineering-workflow.md` and `CODING_STANDARDS.md`. Do not hand-edit installed Matt skills.

## Current limitation

The repository's remote controls were live when this audit was captured, while the Dependabot schedule and decision trail were still local. They are introduced only through the protected pull-request path; this record does not authorize a direct push to `main`.
