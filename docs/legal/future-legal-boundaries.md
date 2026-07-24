# Future legal and distribution boundaries

Last reviewed: 2026-07-24

This record separates the current source-available development beta from
future legal, privacy, commercial, and distribution work. It is a planning
gate, not an EULA, commercial agreement, privacy certification, trademark
registration, or professional legal opinion.

## Current state

- Clarifold's original work is source available under the exact
  [PolyForm Noncommercial 1.0.0 license](../../LICENSE.md), with the [brand and
  copyright notice](../../NOTICE) and [third-party notices](../../THIRD_PARTY_NOTICES.md).
- Commercial software permission and permission to use the Clarifold name,
  icon, or product identity remain separate, private, case-by-case decisions
  requested through `licensing@jeromegroup.org`. A request grants no rights.
- The current macOS candidate is ad-hoc signed and intended for local and CI
  evaluation, not ordinary-user internet distribution. It is not Developer ID
  signed or notarized.
- No public EULA, commercial terms, hosted-service terms, account terms,
  payment terms, or signed-distribution promise is claimed by this beta.

## Human review triggers

Return to Jerome Queck for Singapore-appropriate professional legal review
before any of the following becomes real:

| Trigger | Required review |
| --- | --- |
| Commercial permission, paid distribution, institutional deployment, or material commercial promotion | Commercial terms, ownership, copyright and patent rights, warranties, liability, support boundaries, tax and payment terms, and whether software and brand permissions remain separate. |
| Account, synchronization, hosted storage, telemetry, advertising, payments, or a hosted service | The [privacy notice](../../PRIVACY.md), data-flow inventory, PDPA applicability and DPO obligations, consent or other purposes, retention, access and correction, processors, overseas transfers, security, breach response, and target-jurisdiction requirements. |
| First collaborative code, design, icon, documentation, or substantial mathematical-content contribution | Contributor relationship, ownership or broad irrevocable commercial rights, patent questions, preserved attribution, and written Singapore-appropriate terms before acceptance. |
| Public signed or notarized macOS installer, App Store distribution, or official branded release | Developer ID identity, Hardened Runtime, nested signing, notarization, Gatekeeper assessment, release notices, support and privacy commitments, trademark clearance, and clean-machine evidence. |
| Bug bounty, hosted production data, or a materially expanded security-testing scope | Authorized assets, reporter terms, response capacity, disclosure process, privacy and breach obligations, and the [security policy](../../SECURITY.md). |

The [license and asset audit](dependency-and-asset-license-audit.md) is the
operational record for dependency, asset, and upstream-notice changes. A new
or unknown component, asset, processor, owner, or distribution route is a
stop-and-review trigger; it must not be treated as covered by an earlier
decision.

## Future document order

When a trigger is approved, update the applicable controlling documents before
launch or collection begins:

1. decide the responsible individual or Singapore entity and obtain review;
2. record the data-flow, ownership, dependency, and distribution decisions;
3. publish or update the EULA, commercial permission terms, privacy notice,
   security policy, support boundary, and release notices that actually apply;
4. update the product, package, About surface, and canonical guides together;
   and
5. verify the exact release artifact and evidence before publishing it.

Until those gates are complete, do not describe Clarifold as open source,
formally PDPA-compliant, a guaranteed-support product, a guaranteed-private
service, or an ordinary-user signed download.
