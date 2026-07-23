# Quick Study

Quick Study is a local-first macOS mathematical learning workbench for Advanced Mathematics Learners. It turns typed mathematics, source material, and learner questions into a durable Learning Session that can be examined, practised, and consolidated into evidence.

The built-in Quick Study Study Workspace is the home for loose work. Learners can later file a session into a named Study Workspace and Study Mission without replacing the session or losing its Learning Goal, Session Target, or return context.

Quick Study keeps learner work local by default. Linked Sources remain at their original locations, Personal Notes stay private from ordinary teaching, and model-dependent work is explicit, bounded, cancellable, and recoverable. Teaching output can become a source-linked Learning Artifact or Reformulated Proof with revision provenance, while exact formal verification is shown only for claims actually checked by the recorded Verifier Environment.

## Current status

This is an early macOS beta and a technical-evaluation build, not a public production download. It has no hosted preview or deployment. The architecture-native package is the evaluation artifact; the current build is ad-hoc signed and is not Developer ID signed or notarized for ordinary internet distribution.

The project does not promise mastery, mathematical correctness, or academic outcomes. AI teaching and analysis may be incomplete or wrong. Formal verification applies only to the exact statement and assumptions checked by the Verifier Runtime. Learners control what they save, send, export, and delete.

## Requirements

The validated beta baseline is an Apple Silicon Mac running macOS 14 Sonoma or later with at least 16 GB memory and 12 GB free disk space. Developers need Node.js 22 or 24 and npm 11; Node.js 26 is not supported by the Electron packaging toolchain.

## For developers

The repository keeps each kind of guidance in one canonical place:

- [Development guide](docs/development.md): supported setup, commands, verification, packaging, smoke testing, and troubleshooting.
- [Architecture guide](docs/architecture.md): stable runtime responsibilities, public seams, persistence, and trust boundaries.
- [macOS beta guide](docs/beta-release.md): user-facing evaluation limitations, privacy, recovery, and feedback.
- [Quality and learning evaluation](evaluation/README.md): candidate evidence, benchmark procedures, and the limits of learning claims.
- [Contributing](CONTRIBUTING.md): participation boundary, maintainer workflow, branches, review, and attribution.
- [Coding standards](CODING_STANDARDS.md): the judgement-based engineering and review contract.

Start with the [development guide](docs/development.md) for a build-from-source checkout. Read [CONTEXT.md](CONTEXT.md) for the domain vocabulary and the relevant [architecture decisions](docs/adr/) before changing a boundary.

## Privacy, trust, and feedback

Application state uses Electron's local `userData` directory. The supported `QUICK_STUDY_DATA_DIR` override is for isolated development or diagnosis and must not point at imported learner sources. Do not commit learner data, credentials, or local `.env` files. Optional model access and external research are separate from local source and session work; see the [beta guide](docs/beta-release.md) for the current boundaries and recovery paths.

Use [GitHub Issues](https://github.com/jerome-queck/openai-build-week/issues/new) for public product feedback. Do not attach learner records, source documents, credentials, Personal Notes, or other private data. Include the beta version, macOS version, Mac model, action attempted, visible error, and whether recovery succeeded.

## Maintenance

This README is the product-facing gateway. The maintainer updates it when product identity, supported-user expectations, trust boundaries, screenshots, licensing, or feedback routes change; development and architecture detail belongs in the linked canonical guides.
