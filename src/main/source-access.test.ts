import { describe, expect, it, vi } from "vitest";
import type { LinkedSource } from "../shared/learning-application";
import { MacOsSourceAccess } from "./source-access";

describe("macOS source access", () => {
  it("requests a read-only security-scoped bookmark for a selected file", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["/Users/learner/notes/lecture.pdf"],
      bookmarks: ["opaque-bookmark"]
    });
    const access = new MacOsSourceAccess({
      showOpenDialog,
      stat: vi.fn().mockResolvedValue(fileStat()),
      realpath: vi.fn().mockImplementation(async (path) => path),
      openFile: vi.fn().mockResolvedValue(openedFile(vi.fn().mockResolvedValue(Buffer.from("selected source")))),
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: vi.fn().mockReturnValue(vi.fn())
    });

    const selected = await access.select("file");

    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile"],
      securityScopedBookmarks: true
    }));
    expect(selected).toMatchObject({
      name: "lecture.pdf",
      resourceType: "file",
      lastKnownPath: "/Users/learner/notes/lecture.pdf",
      canonicalPath: "/Users/learner/notes/lecture.pdf",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
      fingerprint: { size: 128, modifiedAtMs: 1234, contentHash: expect.any(String) }
    });
  });

  it("gives a selected filesystem root a stable display name", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/"],
      bookmarks: ["root-bookmark"]
    });
    sourceDependencies.stat.mockResolvedValue({
      size: 64,
      mtimeMs: 1234,
      isFile: () => false,
      isDirectory: () => true
    });

    const selected = await new MacOsSourceAccess(sourceDependencies).select("folder");

    expect(selected).toMatchObject({ name: "/", lastKnownPath: "/", canonicalPath: "/" });
  });

  it("opens a selected file through its canonical path while retaining the bookmark path", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/var/folders/source.pdf"],
      bookmarks: ["source-bookmark"]
    });
    sourceDependencies.realpath.mockResolvedValue("/private/var/folders/source.pdf");
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("selected source"));

    const selected = await new MacOsSourceAccess(sourceDependencies).select("file");

    expect(selected).toMatchObject({
      lastKnownPath: "/var/folders/source.pdf",
      canonicalPath: "/private/var/folders/source.pdf"
    });
    expect(sourceDependencies.openFile).toHaveBeenCalledWith("/private/var/folders/source.pdf");
  });

  it("balances security-scoped access around a read-only file view", async () => {
    const stopAccess = vi.fn();
    const readFile = vi.fn().mockResolvedValue(Buffer.from("A compact space admits a finite subcover."));
    const startAccess = vi.fn().mockReturnValue(stopAccess);
    const access = new MacOsSourceAccess({
      showOpenDialog: vi.fn(),
      stat: vi.fn().mockResolvedValue(fileStat()),
      realpath: vi.fn().mockImplementation(async (path) => path),
      openFile: vi.fn().mockResolvedValue(openedFile(readFile)),
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: startAccess
    });

    const view = await access.read(linkedFile());

    expect(startAccess).toHaveBeenCalledWith("opaque-bookmark");
    expect(readFile).toHaveBeenCalledWith("/Users/learner/notes/lecture.txt");
    expect(stopAccess).toHaveBeenCalledOnce();
    expect(view.content).toContain("finite subcover");
  });

  it("keeps security-scoped access open until an asynchronous read settles", async () => {
    let finishStat!: (value: ReturnType<typeof fileStat>) => void;
    const stopAccess = vi.fn();
    const sourceDependencies = dependencies();
    sourceDependencies.startAccessingSecurityScopedResource.mockReturnValue(stopAccess);
    sourceDependencies.stat.mockReturnValue(new Promise((resolve) => { finishStat = resolve; }));
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("settled"));
    const pending = new MacOsSourceAccess(sourceDependencies).read(linkedFile());

    await Promise.resolve();
    expect(stopAccess).not.toHaveBeenCalled();
    finishStat(fileStat());
    await pending;
    expect(stopAccess).toHaveBeenCalledOnce();
  });

  it("uses a persisted bookmark after a source-access relaunch", async () => {
    const first = dependencies();
    first.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/Users/learner/notes/lecture.txt"],
      bookmarks: ["relaunch-bookmark"]
    });
    first.readFile.mockResolvedValue(Buffer.from("selected"));
    const selected = await new MacOsSourceAccess(first).select("file");
    const second = dependencies();
    const stopAccess = vi.fn();
    second.startAccessingSecurityScopedResource.mockReturnValue(stopAccess);
    second.readFile.mockResolvedValue(Buffer.from("reopened"));

    await new MacOsSourceAccess(second).read({
      ...linkedFile(),
      link: {
        ...linkedFile().link,
        accessGrant: selected!.accessGrant
      }
    });

    expect(second.startAccessingSecurityScopedResource).toHaveBeenCalledWith("relaunch-bookmark");
    expect(second.startAccessingSecurityScopedResource.mock.invocationCallOrder[0])
      .toBeLessThan(second.realpath.mock.invocationCallOrder[0]);
    expect(stopAccess).toHaveBeenCalledOnce();
  });

  it("refreshes a stale bookmark that still resolves before opening the source", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.resolveSecurityScopedBookmark = vi.fn().mockResolvedValue({
      path: "/Users/learner/moved/lecture.txt",
      stale: true,
      refreshedBookmarkData: "refreshed-bookmark"
    });
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("recovered without reselection"));
    const access = new MacOsSourceAccess(sourceDependencies);

    const view = await access.read(linkedFile());

    expect(sourceDependencies.startAccessingSecurityScopedResource).toHaveBeenCalledWith("refreshed-bookmark");
    expect(sourceDependencies.readFile).toHaveBeenCalledWith("/Users/learner/moved/lecture.txt");
    expect(view.linkRefresh).toEqual({
      lastKnownPath: "/Users/learner/moved/lecture.txt",
      canonicalPath: "/Users/learner/moved/lecture.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "refreshed-bookmark" }
    });
  });

  it("uses the refreshed bookmark and resolved path for native Source Index extraction", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.resolveSecurityScopedBookmark = vi.fn().mockResolvedValue({
      path: "/Users/learner/moved/lecture.pdf",
      stale: true,
      refreshedBookmarkData: "refreshed-bookmark"
    });
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("synthetic-pdf"));
    sourceDependencies.extractDocument = vi.fn().mockResolvedValue({
      extractionMethod: "pdfText",
      pages: []
    });
    const access = new MacOsSourceAccess(sourceDependencies);

    await access.extractForIndex({
      ...linkedFile(),
      name: "lecture.pdf",
      link: { ...linkedFile().link, lastKnownPath: "/Users/learner/old/lecture.pdf" }
    });

    expect(sourceDependencies.extractDocument).toHaveBeenCalledWith(Buffer.from("synthetic-pdf"), "lecture.pdf");
    expect(sourceDependencies.startAccessingSecurityScopedResource).toHaveBeenCalledWith("refreshed-bookmark");
  });

  it("returns PDFs as a binary Source Layer instead of decoding them as UTF-8", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("%PDF-1.7\n"));
    const access = new MacOsSourceAccess(sourceDependencies);

    const view = await access.read({ ...linkedFile(), name: "lecture.pdf", link: {
      ...linkedFile().link,
      lastKnownPath: "/Users/learner/notes/lecture.pdf",
      canonicalPath: "/Users/learner/notes/lecture.pdf"
    } });

    expect(view.mediaType).toBe("application/pdf");
    expect(view.content).toBe("data:application/pdf;base64,JVBERi0xLjcK");
  });

  it("reads supported files beneath a Primary Folder without following paths outside it", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.stat.mockImplementation(async (path: string) => ({
      size: path.endsWith("algebra-course") || path.endsWith("notes") ? 64 : 35,
      mtimeMs: 1234,
      isFile: () => !path.endsWith("algebra-course") && !path.endsWith("notes"),
      isDirectory: () => path.endsWith("algebra-course") || path.endsWith("notes")
    }));
    sourceDependencies.readdir.mockImplementation(async (path: string) => path.endsWith("notes")
      ? ["orbits.txt", "diagram.bin"]
      : ["notes", "escaped.txt"]);
    sourceDependencies.realpath.mockImplementation(async (path: string) => path.endsWith("escaped.txt")
      ? "/Users/learner/private/escaped.txt"
      : path);
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("Classify the orbits and stabilizers."));

    const view = await new MacOsSourceAccess(sourceDependencies).read({
      ...linkedFile(),
      name: "algebra-course",
      resourceType: "folder",
      link: {
        ...linkedFile().link,
        lastKnownPath: "/Users/learner/algebra-course",
        canonicalPath: "/Users/learner/algebra-course"
      }
    });

    expect(view.mediaType).toBe("text/plain");
    expect(view.content).toContain("--- notes/orbits.txt ---");
    expect(view.content).toContain("Classify the orbits and stabilizers.");
    expect(sourceDependencies.readFile).not.toHaveBeenCalledWith("/Users/learner/private/escaped.txt");
    expect(sourceDependencies.readFile).not.toHaveBeenCalledWith("/Users/learner/algebra-course/notes/diagram.bin");
  });

  it("fingerprints Primary Folder content so same-size descendant edits are detected", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.stat.mockImplementation(async (path: string) => ({
      size: path.endsWith("algebra-course") ? 64 : 8,
      mtimeMs: 1234,
      isFile: () => !path.endsWith("algebra-course"),
      isDirectory: () => path.endsWith("algebra-course")
    }));
    sourceDependencies.readdir.mockResolvedValue(["lemma.txt"]);
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("Lemma A."));
    const access = new MacOsSourceAccess(sourceDependencies);
    const selected = await access.selectDirectPath("/Users/learner/algebra-course", "folder");

    sourceDependencies.readFile.mockResolvedValue(Buffer.from("Lemma B."));
    const changed = await access.read({
      ...linkedFile(),
      name: selected.name,
      resourceType: "folder",
      link: {
        ...linkedFile().link,
        lastKnownPath: selected.lastKnownPath,
        canonicalPath: selected.canonicalPath,
        fingerprint: selected.fingerprint
      }
    });

    expect(changed.fingerprint).toMatchObject({ size: 64, modifiedAtMs: 1234 });
    expect(changed.fingerprint.contentHash).not.toBe(selected.fingerprint.contentHash);
  });

  it("charges the Primary Folder budget from descriptor bytes instead of stale pathname sizes", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.stat.mockImplementation(async (path: string) => ({
      size: path.endsWith("course") ? 64 : 1,
      mtimeMs: 1234,
      isFile: () => !path.endsWith("course"),
      isDirectory: () => path.endsWith("course")
    }));
    sourceDependencies.readdir.mockResolvedValue(["first.txt", "second.txt"]);
    sourceDependencies.readFile.mockResolvedValue(Buffer.alloc(13 * 1024 * 1024, 0x61));

    await expect(new MacOsSourceAccess(sourceDependencies).read({
      ...linkedFile(),
      name: "course",
      resourceType: "folder",
      link: {
        ...linkedFile().link,
        lastKnownPath: "/Users/learner/course",
        canonicalPath: "/Users/learner/course"
      }
    })).rejects.toThrow("too large for the read-only preview");
  });

  it("stops security-scoped access when reading fails", async () => {
    const stopAccess = vi.fn();
    const access = new MacOsSourceAccess({
      showOpenDialog: vi.fn(),
      stat: vi.fn().mockResolvedValue(fileStat()),
      realpath: vi.fn().mockImplementation(async (path) => path),
      openFile: vi.fn().mockRejectedValue(new Error("volume unavailable")),
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: vi.fn().mockReturnValue(stopAccess)
    });

    await expect(access.read(linkedFile())).rejects.toThrow("volume unavailable");
    expect(stopAccess).toHaveBeenCalledOnce();
  });

  it("rejects an unbookmarked Linked Source whose canonical object escapes after selection", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.realpath.mockResolvedValue("/Users/learner/private/personal-notes.json");

    await expect(new MacOsSourceAccess(sourceDependencies).read({
      ...linkedFile(),
      link: { ...linkedFile().link, accessGrant: null }
    })).rejects.toThrow("no longer resolves to the learner-authorized object");
    expect(sourceDependencies.readFile).not.toHaveBeenCalled();
  });

  it("reads from the identity-checked descriptor when the pathname is swapped after canonicalization", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("PRIVATE OUTSIDE CONTENT"));
    sourceDependencies.openFile.mockResolvedValue(openedFile(
      vi.fn().mockResolvedValue(Buffer.from("Authorized lemma."))
    ));

    const view = await new MacOsSourceAccess(sourceDependencies).read({
      ...linkedFile(),
      link: { ...linkedFile().link, accessGrant: null }
    });

    expect(view.content).toBe("Authorized lemma.");
    expect(sourceDependencies.readFile).not.toHaveBeenCalled();
  });

  it("rejects an oversized file from descriptor metadata before reading its bytes", async () => {
    const sourceDependencies = dependencies();
    const descriptorRead = vi.fn();
    sourceDependencies.openFile.mockResolvedValue({
      stat: vi.fn().mockResolvedValue({ ...fileStat(), size: 25 * 1024 * 1024 + 1 }),
      readFile: descriptorRead,
      close: vi.fn().mockResolvedValue(undefined)
    });

    await expect(new MacOsSourceAccess(sourceDependencies).read(linkedFile()))
      .rejects.toThrow("too large for the read-only preview");
    expect(descriptorRead).not.toHaveBeenCalled();
  });

  it("captures an exact read-only file payload only when a Source Snapshot is requested", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("Exact preserved proof.\n", "utf8"));
    const access = new MacOsSourceAccess(sourceDependencies);

    const snapshot = await access.snapshot(linkedFile());

    expect(snapshot).toEqual({
      mediaType: "text/plain",
      contentBase64: Buffer.from("Exact preserved proof.\n").toString("base64"),
      fingerprint: {
        size: 128,
        modifiedAtMs: 1234,
        contentHash: "e836442fb09dccf955cb086fdb8e7174cc17c607f2eba7ade175a855801eafaf"
      }
    });
    expect(sourceDependencies.readFile).toHaveBeenCalledTimes(1);
    expect(sourceDependencies.readFile).toHaveBeenCalledWith("/Users/learner/notes/lecture.txt");
  });

  it("returns refreshed bookmark metadata with an explicit Source Snapshot", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.resolveSecurityScopedBookmark.mockResolvedValue({
      path: "/Users/learner/moved/lecture.txt",
      stale: true,
      refreshedBookmarkData: "snapshot-bookmark"
    });
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("snapshot"));

    const snapshot = await new MacOsSourceAccess(sourceDependencies).snapshot(linkedFile());

    expect(snapshot.linkRefresh).toEqual({
      lastKnownPath: "/Users/learner/moved/lecture.txt",
      canonicalPath: "/Users/learner/moved/lecture.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "snapshot-bookmark" }
    });
  });

  it("preserves every supported Primary Folder file in an exact snapshot manifest", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.stat.mockImplementation(async (path: string) => ({
      size: path.endsWith("course") ? 64 : 8,
      mtimeMs: 1234,
      isFile: () => !path.endsWith("course"),
      isDirectory: () => path.endsWith("course")
    }));
    sourceDependencies.readdir.mockResolvedValue(["diagram.png", "notes.txt", "private.bin"]);
    sourceDependencies.readFile.mockImplementation(async (path: string) => Buffer.from(`bytes:${path.split("/").at(-1)}`));
    const source = {
      ...linkedFile(),
      name: "course",
      resourceType: "folder" as const,
      link: {
        ...linkedFile().link,
        lastKnownPath: "/Users/learner/course",
        canonicalPath: "/Users/learner/course"
      }
    };

    const snapshot = await new MacOsSourceAccess(sourceDependencies).snapshot(source);
    const manifest = JSON.parse(Buffer.from(snapshot.contentBase64, "base64").toString("utf8"));

    expect(manifest).toEqual({
      format: "quick-study-folder-snapshot-v1",
      files: [
        { path: "diagram.png", contentBase64: Buffer.from("bytes:diagram.png").toString("base64") },
        { path: "notes.txt", contentBase64: Buffer.from("bytes:notes.txt").toString("base64") }
      ]
    });
    expect(sourceDependencies.readFile).not.toHaveBeenCalledWith("/Users/learner/course/private.bin");
  });

  it("extracts searchable text, equation geometry, page geometry, and a small thumbnail", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("First page has $x^2$.\fSecond page proves compactness."));
    const access = new MacOsSourceAccess(sourceDependencies);

    const extraction = await access.extractForIndex(linkedFile());

    expect(extraction).toMatchObject({
      extractionMethod: "embeddedText",
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1400,
          thumbnailDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
          regions: expect.arrayContaining([
            expect.objectContaining({ kind: "text", text: "First page has $x^2$.", sourceStartOffset: 0 }),
            expect.objectContaining({ kind: "equation", text: "$x^2$", sourceStartOffset: 15 })
          ])
        },
        { pageNumber: 2, regions: [expect.objectContaining({ text: "Second page proves compactness." })] }
      ]
    });
  });

  it("rejects an embedded-text source over the Source Index page budget", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from(Array.from({ length: 257 }, () => "lemma").join("\f")));

    await expect(new MacOsSourceAccess(sourceDependencies).extractForIndex(linkedFile()))
      .rejects.toThrow("too complex to index safely");
  });

  it("keeps the pinned 50,000-line text corpus within the Source Index budget", async () => {
    const sourceDependencies = dependencies();
    const content = Array.from({ length: 50_000 }, (_, index) => `Reference ${index + 1}: retain its assumptions.`).join("\n");
    sourceDependencies.readFile.mockResolvedValue(Buffer.from(content));

    const extraction = await new MacOsSourceAccess(sourceDependencies).extractForIndex(linkedFile());

    expect(extraction.pages).toHaveLength(1);
    expect(extraction.pages[0].regions).toHaveLength(50_000);
  });

  it("stops building embedded-text regions as soon as the Source Index budget is exceeded", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("line\n".repeat(100_001)));

    await expect(new MacOsSourceAccess(sourceDependencies).extractForIndex(linkedFile()))
      .rejects.toThrow("too complex to index safely");
  });

  it("uses the bounded native extractor for OCR and image geometry", async () => {
    const sourceDependencies = {
      ...dependencies(),
      extractDocument: vi.fn().mockResolvedValue({
        extractionMethod: "ocr" as const,
        pages: [{
          pageNumber: 1,
          width: 800,
          height: 600,
          thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
          regions: [{
            kind: "text" as const,
            text: "Assume the sequence is Cauchy",
            bounds: { x: 0.1, y: 0.2, width: 0.7, height: 0.08 }
          }]
        }]
      })
    };
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("synthetic-image"));
    const access = new MacOsSourceAccess(sourceDependencies);
    const image = {
      ...linkedFile(),
      name: "proof.png",
      link: {
        ...linkedFile().link,
        lastKnownPath: "/Users/learner/notes/proof.png",
        canonicalPath: "/Users/learner/notes/proof.png"
      }
    };

    const extraction = await access.extractForIndex(image);

    expect(sourceDependencies.extractDocument).toHaveBeenCalledWith(Buffer.from("synthetic-image"), "proof.png");
    expect(extraction).toMatchObject({
      extractionMethod: "ocr",
      pages: [{ thumbnailDataUrl: "data:image/png;base64,c21hbGw=", regions: [expect.objectContaining({
        text: "Assume the sequence is Cauchy"
      })] }]
    });
  });

  it("rejects native extraction when the source changes before extraction completes", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.stat
      .mockResolvedValueOnce(fileStat())
      .mockResolvedValueOnce({ ...fileStat(), size: 129, mtimeMs: 5678 });
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("synthetic-pdf"));
    sourceDependencies.extractDocument = vi.fn().mockResolvedValue({ extractionMethod: "pdfText", pages: [] });
    const source = { ...linkedFile(), name: "lecture.pdf" };

    await expect(new MacOsSourceAccess(sourceDependencies).extractForIndex(source))
      .rejects.toThrow(/changed while/);
  });

  it("rejects native extraction results that exceed the retained Source Index budget", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("synthetic-pdf"));
    sourceDependencies.extractDocument = vi.fn().mockResolvedValue({
      extractionMethod: "pdfText",
      pages: Array.from({ length: 257 }, (_, index) => ({
        pageNumber: index + 1,
        width: 612,
        height: 792,
        thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
        regions: []
      }))
    });

    await expect(new MacOsSourceAccess(sourceDependencies).extractForIndex({ ...linkedFile(), name: "lecture.pdf" }))
      .rejects.toThrow("too complex to index safely");
  });

  it("rejects structurally invalid native extractor output at the process boundary", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("synthetic-pdf"));
    sourceDependencies.extractDocument = vi.fn().mockResolvedValue({ extractionMethod: "pdfText", pages: "invalid" });

    await expect(new MacOsSourceAccess(sourceDependencies).extractForIndex({ ...linkedFile(), name: "lecture.pdf" }))
      .rejects.toThrow("native source extractor returned an invalid response");
  });
});

function fileStat() {
  return { size: 128, mtimeMs: 1234, isFile: () => true, isDirectory: () => false };
}

function dependencies() {
  const result = {
    showOpenDialog: vi.fn(),
    stat: vi.fn().mockResolvedValue(fileStat()),
    realpath: vi.fn().mockImplementation(async (path) => path),
    readFile: vi.fn(),
    openFile: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    startAccessingSecurityScopedResource: vi.fn(),
    resolveSecurityScopedBookmark: vi.fn().mockResolvedValue(null)
  };
  result.openFile.mockImplementation(async (path: string) => openedFile(result.readFile, result.stat, path));
  return result;
}

function openedFile(
  readFile: ReturnType<typeof vi.fn>,
  stat: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(fileStat()),
  path = "/Users/learner/notes/lecture.txt"
) {
  let content: Promise<Buffer> | null = null;
  return {
    stat: vi.fn().mockImplementation(() => stat(path)),
    read: vi.fn().mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
      content ??= readFile(path);
      const source = await content;
      const bytesRead = source.copy(buffer, offset, position, Math.min(position + length, source.byteLength));
      return { bytesRead };
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function linkedFile(): LinkedSource {
  return {
    id: "source-1",
    kind: "linkedSource",
    role: "externalAttachment",
    workspaceId: "workspace-1",
    name: "lecture.txt",
    resourceType: "file",
    link: {
      lastKnownPath: "/Users/learner/notes/lecture.txt",
      canonicalPath: "/Users/learner/notes/lecture.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
      fingerprint: { size: 128, modifiedAtMs: 1234 },
      accessStatus: "available",
      error: null
    }
  };
}
