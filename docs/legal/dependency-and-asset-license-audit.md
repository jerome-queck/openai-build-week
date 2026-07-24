# Dependency and asset license audit

Last audited: 2026-07-24

## Scope and method

This audit covers the original Clarifold repository material, the pinned
production dependency graph, the Electron macOS package, and the bundled
Verifier Environment. It checks the declared npm metadata and lockfile,
tracked assets, the Electron Forge resource list, and the license files copied
by [`scripts/prepare-lean-runtime.mjs`](../../scripts/prepare-lean-runtime.mjs).
The audit is a compatibility record, not legal advice or a substitute for
review of a future distribution transaction.

## Compatibility record

| Surface | Observed material | Compatibility decision | Required attribution |
| --- | --- | --- | --- |
| Original application, native helpers, tests, and documentation | Jerome Queck's repository material | Compatible with the root PolyForm Noncommercial 1.0.0 license; no outside contribution rights are inferred | `NOTICE` and the root `LICENSE.md` |
| Production npm runtime graph | React 19.2.7, React DOM 19.2.7, and transitive scheduler 0.27.0 | MIT terms are compatible when their notices remain available; the exact runtime graph remains in `package-lock.json` | `THIRD_PARTY_NOTICES.md` and package metadata |
| Electron runtime and Chromium | Electron 43.1.1 and its bundled Chromium distribution | Preserve Electron's and Chromium's generated notice files; do not collapse their upstream licenses into the PolyForm terms | Electron's packaged `ELECTRON_LICENSE` and `CHROMIUM_LICENSES.html` in application resources, plus `THIRD_PARTY_NOTICES.md` |
| Verifier Environment | Lean 4.29.1 and mathlib 4.29.1 at the pinned commit | Preserve the upstream license files copied into `Resources/verifiers/`; generated proof artifacts are not relicensed | `Resources/verifiers/LICENSE`, `LICENSES/`, and `mathlib-LICENSE` |
| Tracked visual and font assets | No third-party assets currently tracked or bundled | No unresolved asset license is present; a future asset requires a source and rights record before merge | This audit and `THIRD_PARTY_NOTICES.md` |
| Adapted policy material | Clarifold's `CODE_OF_CONDUCT.md` adapted from Contributor Covenant 3.0 | CC BY-SA 4.0 attribution and license link remain available; project-specific reporting and enforcement text is identified as an adaptation | `CODE_OF_CONDUCT.md` and `THIRD_PARTY_NOTICES.md` |

The root `LICENSE.md` is the exact official PolyForm Noncommercial 1.0.0 text.
The package metadata uses the canonical machine-readable identifier
`PolyForm-Noncommercial-1.0.0`, while `private: true` prevents accidental npm
publication. The package includes `LICENSE.md`, `NOTICE`, and this repository's
third-party notice index as extra resources; Electron and Verifier Environment
upstream notices remain in their respective package locations.

## Open review triggers

The current development beta does not require professional legal review. A
Singapore-appropriate professional review must be brought back to Jerome Queck
before any of these events:

- a commercial permission, paid software distribution, hosted service,
  account/synchronization feature, payment flow, or institutional deployment;
- the first collaborative code, design, icon, documentation, or substantial
  mathematical-content contribution;
- adding a dependency, generated runtime, font, image, icon, or other asset
  whose license or notice is not already recorded here;
- a public signed and notarized installer, App Store distribution, or a
  release that makes trademark or commercial promotion material; or
- serious commercial promotion, material investment in the Clarifold brand, or
  a collaborator representing the product under that name.

At those gates, review must reconsider ownership or contributor terms,
copyright and patent questions, trademark clearance and filing, third-party
terms, privacy and data-processing obligations, warranties and liability,
distribution notices, and whether the software and Clarifold brand permissions
remain separate. The current record does not claim trademark registration,
patent protection, formal PDPA compliance, or open-source status.

The broader EULA, commercial-permission, privacy, collaboration, and signed-
distribution gates are recorded in the [future legal-boundaries record](future-legal-boundaries.md).

## Recheck procedure

Before each release candidate, maintainers must:

1. run `npm audit --omit=dev --audit-level=high` and inspect the complete
   production dependency graph;
2. run `npm run license:audit` against the exact package and inspect the
   packaged application for `LICENSE.md`, `NOTICE`,
   `THIRD_PARTY_NOTICES.md`, Electron/Chromium notices, and Verifier Environment
   upstream license files;
3. compare newly shipped files and assets with this audit and stop on an
   unknown or disallowed license; and
4. update this audit and the third-party notice index in the same change when
   a component, asset, owner, or legal decision changes.
