# Link disk-backed sources without duplicating them

The macOS app will keep every existing disk-backed source at its original local location. A Linked Source will use a Source Link Record containing a read-only security-scoped bookmark as the canonical permission and locator, a last-known path for display and recovery, and a lightweight Source Fingerprint for identity and change detection. The app will not create a source copy, symbolic link, or Finder alias as part of this flow.

Stale bookmarks will be refreshed when they still resolve. A missing, unavailable, or inaccessible source will retain its association and Session Record while presenting Retry and Locate again recovery actions; re-selection replaces the failed bookmark. Managed Assets are reserved for inputs with no existing backing file, such as pasted images and captures, or for a copy the learner explicitly requests.

The app may retain a rebuildable Source Index containing extracted text, OCR, equation and page geometry, small thumbnails, and search metadata needed for fast retrieval and stable Source Anchors. This derived cache is not the canonical source or a duplicate PDF. It remains local, can be cleared and rebuilt, and must not be required to reconstruct source content that no longer exists.

When exact reproducibility matters, the learner may explicitly invoke `Preserve source snapshot`. This creates a Source Snapshot as a Managed Asset for the selected Source Revision and keeps its relationship to the Linked Source visible. The app never creates such a duplicate automatically, and the snapshot neither replaces nor modifies the external file.

When a Source Fingerprint changes, the app will expose a new Source Revision and rebuild the Source Index. Re-anchoring may carry an annotation or Teaching Card forward automatically only when the match is strong. Uncertain or missing matches become visible Unresolved Anchors for learner review; the product will not silently attach prior reasoning to potentially different mathematics.

This follows the platform findings in [macOS security-scoped bookmarks](../research/macos-security-scoped-bookmarks.md): location indirection is not permission, and Apple's supported persistent sandbox-access mechanism is a security-scoped bookmark rather than a path or symlink.
