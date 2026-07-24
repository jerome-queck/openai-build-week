# Third-party notices

This file records the third-party components included in a Clarifold
source checkout or macOS evaluation package. Each component keeps its
own copyright and license. The PolyForm Noncommercial License applies
only to Clarifold's original work and does not replace a third-party
license.

## Application dependencies

| Component | Version | License | Attribution and source |
| --- | --- | --- | --- |
| Electron | 43.1.1 | MIT | [Electron](https://github.com/electron/electron), including the Electron `LICENSE` and Chromium `LICENSES.chromium.html` copied into the application resources as `ELECTRON_LICENSE` and `CHROMIUM_LICENSES.html` |
| Chromium | Bundled by Electron 43.1.1 | Chromium/BSD and other upstream licenses | The packaged Electron application retains `LICENSES.chromium.html`; see [Chromium licensing](https://www.chromium.org/chromium-projects/licensing) and the bundled notice for the complete attribution set |
| React | 19.2.7 | MIT | [React](https://github.com/facebook/react) |
| React DOM | 19.2.7 | MIT | [React](https://github.com/facebook/react) |
| scheduler | 0.27.0 | MIT | [scheduler](https://github.com/facebook/react/tree/main/packages/scheduler), transitive runtime dependency of React DOM |

The complete transitive npm dependency inventory and license metadata are
recorded in `package-lock.json`. Production dependencies must be audited
with `npm audit --omit=dev --audit-level=high` before a release candidate.

## Bundled verification environment

| Component | Version | License | Attribution and package location |
| --- | --- | --- | --- |
| Lean toolchain | 4.29.1 | Apache-2.0 | [Lean](https://github.com/leanprover/lean4); the packaged environment retains its upstream `LICENSE` and `LICENSES` files under `Resources/verifiers/` |
| mathlib | 4.29.1 at commit `5e932f97dd25535344f80f9dd8da3aab83df0fe6` | Apache-2.0 | [mathlib4](https://github.com/leanprover-community/mathlib4); the packaged environment retains `mathlib-LICENSE` under `Resources/verifiers/` |

The pinned source archive digest, supported modules, and runtime format are
recorded in [`src/shared/bundled-verifier-environment.json`](src/shared/bundled-verifier-environment.json).
The build copies the upstream license files into the staged environment
before packaging and does not relicense generated Lean or mathlib artifacts.

## Clarifold-owned material and assets

The Clarifold application, native helpers, documentation, tests, and the
current tracked product assets are original repository material covered by
the root [`LICENSE`](LICENSE), except where a file or notice says otherwise.
The packaged `source-bookmark-helper` and `source-index-extractor` binaries
are built from the repository's native helpers and remain covered by that
same notice.

| Native helper | Source | License | Attribution and package location |
| --- | --- | --- | --- |
| `source-bookmark-helper` | Repository `native/source-bookmark-helper.swift` | PolyForm-Noncommercial-1.0.0 | Packaged native helper binary under `Resources/app.asar.unpacked/dist/helpers/`; covered by the root Clarifold license and this notice |
| `source-index-extractor` | Repository `native/source-index-extractor.swift` | PolyForm-Noncommercial-1.0.0 | Packaged native helper binary under `Resources/app.asar.unpacked/dist/helpers/`; covered by the root Clarifold license and this notice |

The repository currently has no third-party fonts, images, icon artwork, or
other bundled visual assets. A future asset must be added only with a recorded
source, license, attribution, and compatibility decision in the audit linked
below.

## Audit and release triggers

The compatibility and asset review is maintained in
[`docs/legal/dependency-and-asset-license-audit.md`](docs/legal/dependency-and-asset-license-audit.md).
An unknown license, missing upstream notice, new bundled dependency or asset,
external contributor, commercial permission, paid distribution, hosted data
service, or public signed/notarized release is a stop-and-review trigger.
