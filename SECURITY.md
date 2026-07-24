# Clarifold security policy

This policy describes the supported security-reporting route and the limited
boundary for good-faith security testing. It is not a bug bounty, a support
level agreement, a guarantee of a fix, or permission to test systems that
Clarifold does not own.

## Reporting a suspected vulnerability

Use [GitHub Private Vulnerability Reporting](https://github.com/jerome-queck/clarifold/security/advisories/new)
as the primary channel. If that channel is unavailable, email
[security@jeromegroup.org](mailto:security@jeromegroup.org). Do not disclose a
suspected vulnerability through a public issue, pull request, social post, or
teaching-content example while it remains unresolved. Conduct reports go to
[conduct@jeromegroup.org](mailto:conduct@jeromegroup.org), not this address.

Please include only the minimum useful detail:

- the affected version, commit, or newest beta candidate;
- a concise description, reproduction steps, expected and observed behavior,
  impact, affected boundary, and the smallest synthetic fixture needed;
- whether the report is reproducible; and
- a safe contact route for clarification and whether you want attribution.

Do not include learner records, another person's data, credentials, private
keys, or a complete source document. Redact them before sending a report.

## Supported versions

Until Clarifold has a stable release, the newest published beta candidate is
the only version supported for security fixes. Older candidates, source
snapshots, and modified forks have no promise of a fix, although reports may
still be considered. This support rule will be reconsidered for the first
stable release and before any hosted service or public bug-bounty program.

## Response and coordinated disclosure

Jerome Queck is the current maintainer and the person who reviews private
reports. We will try to acknowledge a report, ask for the minimum clarification
needed, validate its impact, and decide whether a fix, mitigation, advisory, or
disclosure is appropriate. Capacity is limited and there is no guaranteed
response time, severity, remediation date, payment, or CVE assignment.

Please keep details private while we investigate and coordinate a disclosure
date. We may publish a disclosure-safe summary after a fix or mitigation is
available, and will preserve reporter credit when requested and appropriate.
If a report is not a vulnerability, we may route it to the relevant public
product-feedback channel without copying private details.

## Good-faith security testing

Testing is authorized only when all of these conditions hold:

- you test Clarifold source or a build that you control, using synthetic data;
- you collect the minimum evidence needed and report it privately;
- you stop and ask before continuing if scope is uncertain; and
- you avoid retaining or sharing sensitive material after the report.

The following are outside scope and are not authorized by this policy:

- investigating Jerome Queck, his accounts or devices, or another learner;
- testing GitHub, OpenAI, Apple, an email provider, or any other third party;
- social engineering, credential attacks, persistence, malware, denial of
  service, destructive changes, disruption, or privacy-invasive collection; or
- public disclosure of an unresolved vulnerability or access to another
  person's data.

Clarifold will not initiate legal action over testing that follows this
published boundary. This limited statement does not create immunity from
third-party claims, control another system's rules, or authorize activity that
violates applicable law or a provider's terms.

## Security research is not teaching-content research

Good-faith product security testing exists to find and privately report a
weakness in Clarifold code or a controlled build. It is not permission to turn
a vulnerability report, private report, learner material, or another person's
system into a lesson, benchmark, blog post, or source excerpt. Research used to
build teaching content must use lawful, appropriately licensed, public or
explicitly authorized sources, keep its own provenance, and follow the
[third-party license audit](docs/legal/dependency-and-asset-license-audit.md).
Security details remain in the private reporting process unless and until a
coordinated disclosure makes a safe public summary appropriate.

## Future scope review

The current scope covers the repository and newest published beta only. Before
Clarifold operates a hosted service, accepts external production data, offers
a bug-bounty program, or publishes a signed and notarized ordinary-user build,
the maintainer must review this policy, enumerate in-scope assets, confirm the
reporting and response capacity, and obtain appropriate Singapore-focused legal
review. See the [future legal-boundaries record](docs/legal/future-legal-boundaries.md).
