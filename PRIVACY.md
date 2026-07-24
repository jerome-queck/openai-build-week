# Clarifold privacy notice

Last updated: 2026-07-24

This notice describes the current Clarifold development beta. It is a factual
description of the product's present data boundaries, not legal advice, a
promise of confidentiality, or a claim that Clarifold complies with every
privacy law in every place. It must be updated before a product data flow or
third-party processor changes.

## Current product boundary

Clarifold is a local-first macOS learning workbench. In this beta, Clarifold
does not provide a Clarifold account system, hosted learner-data storage,
advertising, product analytics, payments, or a hosted synchronization service.
The absence of those services is a statement about the current build only; it
is not a promise that a future version will never add them.

The application can still use network-connected capabilities. Model access is
provided through the Codex Runtime and may send an explicitly requested prompt,
the context selected for that request, and the resulting work through the
provider's service. External research is a separate, learner-requested
capability and can send a bounded query to an approved destination. Local
working, editing, searching, exporting, and installed formal verification do
not require model access.

Review the [macOS beta guide](docs/beta-release.md) for the supported product
limitations and the [architecture guide](docs/architecture.md) for the stable
trust boundaries. Do not interpret “local-first” as “everything is offline.”

## What the beta stores locally

The application stores its durable state in Electron's local `userData`
directory, or in the explicitly selected `QUICK_STUDY_DATA_DIR` directory for
isolated development and diagnosis. This can include:

- Learning Sessions, Learning Trails, questions, annotations, Personal Notes,
  Learning Artifacts, verification evidence, settings, and resumable Agent
  Task checkpoints;
- Linked Source locations, fingerprints, index metadata, source revisions, and
  bounded snapshots or excerpts selected for a learner action; and
- model and operation state needed to show an honest stopped, failed,
  resumable, or completed result.

Clarifold does not own or silently relocate Linked Source files. Indexing,
verification, export, and recovery do not replace the original source bytes.
The application retains local records until the learner deletes them or the
operating system's storage and backup practices remove them. A normal backup
can retain copies after local deletion.

## What may leave the Mac

Nothing in the following list is sent merely because a source or note is linked:

| Activity | Boundary and learner control |
| --- | --- |
| Local work | Session state, Personal Notes, search, indexes, exports, and local verification stay on the Mac unless the learner chooses another destination. |
| Model teaching or analysis | The learner starts the action and reviews the access decision. Clarifold sends only the bounded context required for that action through the Codex Runtime. Personal Notes remain excluded from ordinary teaching. |
| Source Excerpt Egress | A learner-visible, session-scoped permission controls a bounded excerpt for the specific governed action. It is inspectable and revocable; it is not blanket permission to send a Linked Source. |
| External research | A separate, bounded query is sent to the approved research destination. Research results are not proof of correctness and are recorded with their source provenance. |
| Public reports | GitHub issues, pull requests, and email are external channels. Never put learner records, source documents, Personal Notes, credentials, or private vulnerability details in a public report. |

Codex owns its authentication flow. Clarifold does not persist ChatGPT or
OpenAI API-key credentials in its learner state. Codex, an external research
destination, GitHub, and email providers may have their own terms, retention,
and privacy practices; review those terms before using them with sensitive
material.

## Access, export, and deletion

Learners choose what to save, send, export, and delete. Clarifold supports
local editing, deletion actions exposed by the application, and explicit
artifact export. To remove the remaining beta application state, quit the app
and use the operating system's normal controls for its application-data
directory, taking care not to delete Linked Sources unless that is intended.
Back up data before destructive repair. Linked Sources require their own
backup and deletion decisions because Clarifold does not own those files.

For a question about local records, export, deletion, or suspected mishandling
of personal data, contact [privacy@jeromegroup.org](mailto:privacy@jeromegroup.org).
This address is a private project contact, not a formally designated Data
Protection Officer. Please send only the minimum information needed to answer
the question; do not forward credentials or complete learner records.

## Report handling

Private privacy, security, conduct, and licensing reports are kept separate
from public issues. Access is restricted to Jerome Queck as the current
maintainer, reports are not copied into public issue content, and records are
retained only for the handling, safety, legal, and accountability purpose that
requires them. When a record is no longer needed, it is securely deleted using
the available provider and mailbox controls, subject to necessary backups and
legal preservation. Suspected vulnerabilities belong on the separate
[security-reporting path](SECURITY.md), not at the privacy address or in a
public issue.

## Singapore and future global review gates

Clarifold is started and owned in Singapore with intended global reach. Before
Clarifold itself collects learner or customer data through any of the following,
Jerome Queck must approve a fresh Singapore PDPA and target-jurisdiction
privacy review:

- accounts, sign-in, synchronization, hosted storage, or a hosted service;
- product analytics, telemetry, advertising, or profiling;
- payments, institutional deployment, or commercial customer support; or
- a new processor, cross-border transfer, automated decision, or materially
  expanded model or research data flow.

That review must identify the operating person or entity, purposes and lawful
basis or consent approach, access and correction handling, retention and
deletion, processors and overseas transfers, security and breach response,
possible DPO obligations, and additional requirements in target jurisdictions.
The public notice and data-flow inventory must be updated before the new
collection begins. This beta notice does not claim formal PDPA compliance.

See the [future legal-boundaries record](docs/legal/future-legal-boundaries.md)
for the related EULA, commercial, distribution, and professional-review gates.
