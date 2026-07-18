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
      readFile: vi.fn(),
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: vi.fn()
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
      fingerprint: { size: 128, modifiedAtMs: 1234 }
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

  it("balances security-scoped access around a read-only file view", async () => {
    const stopAccess = vi.fn();
    const readFile = vi.fn().mockResolvedValue(Buffer.from("A compact space admits a finite subcover."));
    const startAccess = vi.fn().mockReturnValue(stopAccess);
    const access = new MacOsSourceAccess({
      showOpenDialog: vi.fn(),
      stat: vi.fn().mockResolvedValue(fileStat()),
      realpath: vi.fn().mockImplementation(async (path) => path),
      readFile,
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: startAccess
    });

    const view = await access.read(linkedFile());

    expect(startAccess).toHaveBeenCalledWith("opaque-bookmark");
    expect(readFile).toHaveBeenCalledWith("/Users/learner/notes/lecture.txt");
    expect(stopAccess).toHaveBeenCalledOnce();
    expect(view.content).toContain("finite subcover");
  });

  it("uses a persisted bookmark after a source-access relaunch", async () => {
    const first = dependencies();
    first.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/Users/learner/notes/lecture.txt"],
      bookmarks: ["relaunch-bookmark"]
    });
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
    expect(stopAccess).toHaveBeenCalledOnce();
  });

  it("returns PDFs as a binary Source Layer instead of decoding them as UTF-8", async () => {
    const sourceDependencies = dependencies();
    sourceDependencies.readFile.mockResolvedValue(Buffer.from("%PDF-1.7\n"));
    const access = new MacOsSourceAccess(sourceDependencies);

    const view = await access.read({ ...linkedFile(), name: "lecture.pdf", link: {
      ...linkedFile().link,
      lastKnownPath: "/Users/learner/notes/lecture.pdf"
    } });

    expect(view.mediaType).toBe("application/pdf");
    expect(view.content).toBe("data:application/pdf;base64,JVBERi0xLjcK");
  });

  it("stops security-scoped access when reading fails", async () => {
    const stopAccess = vi.fn();
    const access = new MacOsSourceAccess({
      showOpenDialog: vi.fn(),
      stat: vi.fn().mockResolvedValue(fileStat()),
      realpath: vi.fn().mockImplementation(async (path) => path),
      readFile: vi.fn().mockRejectedValue(new Error("volume unavailable")),
      readdir: vi.fn(),
      startAccessingSecurityScopedResource: vi.fn().mockReturnValue(stopAccess)
    });

    await expect(access.read(linkedFile())).rejects.toThrow("volume unavailable");
    expect(stopAccess).toHaveBeenCalledOnce();
  });
});

function fileStat() {
  return { size: 128, mtimeMs: 1234, isFile: () => true, isDirectory: () => false };
}

function dependencies() {
  return {
    showOpenDialog: vi.fn(),
    stat: vi.fn().mockResolvedValue(fileStat()),
    realpath: vi.fn().mockImplementation(async (path) => path),
    readFile: vi.fn(),
    readdir: vi.fn(),
    startAccessingSecurityScopedResource: vi.fn()
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
