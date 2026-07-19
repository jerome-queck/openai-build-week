import { createHash } from "node:crypto";
import { basename, extname, join, relative, sep } from "node:path";
import type {
  AvailableLinkedSourceView,
  LinkedSource,
  LocalSourceAccess,
  SelectedLocalSource,
  SourceIndexExtraction,
  SourceIndexExtractionResult,
  SourceFingerprint
} from "../shared/learning-application";

const MAX_SOURCE_VIEW_BYTES = 25 * 1024 * 1024;

interface FileStat {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

interface SourceAccessDependencies {
  showOpenDialog(options: {
    properties: Array<"openFile" | "openDirectory">;
    securityScopedBookmarks: true;
    title: string;
    buttonLabel: string;
  }): Promise<{ canceled: boolean; filePaths: string[]; bookmarks?: string[] }>;
  stat(path: string): Promise<FileStat>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  startAccessingSecurityScopedResource(bookmarkData: string): () => void;
  resolveSecurityScopedBookmark?(bookmarkData: string): Promise<{
    path: string;
    stale: boolean;
    refreshedBookmarkData?: string;
  } | null>;
  extractDocument?(path: string): Promise<SourceIndexExtraction>;
}

export class MacOsSourceAccess implements LocalSourceAccess {
  constructor(private readonly dependencies: SourceAccessDependencies) {}

  async select(resourceType: "file" | "folder"): Promise<SelectedLocalSource | null> {
    const result = await this.dependencies.showOpenDialog({
      properties: [resourceType === "file" ? "openFile" : "openDirectory"],
      securityScopedBookmarks: true,
      title: resourceType === "file" ? "Choose an External Attachment" : "Choose a Primary Folder",
      buttonLabel: resourceType === "file" ? "Link Attachment" : "Link Primary Folder"
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.describePath(result.filePaths[0], resourceType, result.bookmarks?.[0]);
  }

  async selectDirectPath(path: string, resourceType: "file" | "folder"): Promise<SelectedLocalSource> {
    return this.describePath(path, resourceType);
  }

  async read(source: LinkedSource): Promise<AvailableLinkedSourceView> {
    const location = await this.resolveSourceLocation(source);
    const stopAccess = location.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(location.bookmarkData)
      : null;
    try {
      return await this.readAtLocation(source, location);
    } finally {
      stopAccess?.();
    }
  }

  async extractForIndex(source: LinkedSource): Promise<SourceIndexExtractionResult> {
    const location = await this.resolveSourceLocation(source);
    const stopAccess = location.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(location.bookmarkData)
      : null;
    try {
      const view = await this.readAtLocation(source, location);
      const extractionMethod = view.mediaType === "text/plain"
        ? "embeddedText"
        : view.mediaType === "application/pdf"
          ? "pdfText"
          : view.mediaType === "image/png" || view.mediaType === "image/jpeg"
            ? "ocr"
            : null;
      if (!extractionMethod) throw new Error("This source type does not have indexable mathematical content.");
      let extraction: SourceIndexExtraction;
      if (view.mediaType !== "text/plain") {
        if (!this.dependencies.extractDocument) throw new Error("Native document indexing is unavailable.");
        extraction = await this.dependencies.extractDocument(location.path);
      } else {
        extraction = textSourceIndexExtraction(view.content, EMPTY_THUMBNAIL_DATA_URL);
      }
      const afterExtraction = await this.readAtLocation(source, location);
      if (!sameFingerprint(view.fingerprint, afterExtraction.fingerprint)) {
        throw new Error("This source changed while its Source Index was being built. Retry after the source is stable.");
      }
      return {
        ...extraction,
        fingerprint: view.fingerprint,
        ...(view.linkRefresh ? { linkRefresh: view.linkRefresh } : {})
      };
    } finally {
      stopAccess?.();
    }
  }

  async snapshot(source: LinkedSource) {
    const location = await this.resolveSourceLocation(source);
    const stopAccess = location.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(location.bookmarkData)
      : null;
    try {
      const view = await this.readAtLocation(source, location);
      if (source.resourceType === "file") {
        const content = await this.dependencies.readFile(location.path);
        const afterSnapshotFingerprint = fingerprint(await this.dependencies.stat(location.path));
        if (!sameFingerprint(view.fingerprint, afterSnapshotFingerprint)) {
          throw new Error("This source changed while its Source Snapshot was being preserved. Retry after the source is stable.");
        }
        return {
          mediaType: view.mediaType,
          contentBase64: content.toString("base64"),
          fingerprint: view.fingerprint,
          ...(view.linkRefresh ? { linkRefresh: view.linkRefresh } : {})
        };
      }
      const files = (await this.readBoundedFolderFiles(
        location.path,
        (name) => sourceMediaType(name) === "text/plain",
        "This folder is too large to preserve as a Source Snapshot."
      )).map((file) => ({ path: file.path, contentBase64: file.content.toString("base64") }));
      const afterSnapshot = await this.readAtLocation(source, location);
      if (!sameFingerprint(view.fingerprint, afterSnapshot.fingerprint)) {
        throw new Error("This source changed while its Source Snapshot was being preserved. Retry after the source is stable.");
      }
      return {
        mediaType: "application/vnd.quick-study.folder-snapshot+json" as const,
        contentBase64: Buffer.from(JSON.stringify({ format: "quick-study-folder-snapshot-v1", files })).toString("base64"),
        fingerprint: view.fingerprint,
        ...(view.linkRefresh ? { linkRefresh: view.linkRefresh } : {})
      };
    } finally {
      stopAccess?.();
    }
  }

  private async resolveSourceLocation(source: LinkedSource): Promise<{
    path: string;
    bookmarkData?: string;
    refreshed: boolean;
  }> {
    const resolved = source.link.accessGrant && this.dependencies.resolveSecurityScopedBookmark
      ? await this.dependencies.resolveSecurityScopedBookmark(source.link.accessGrant.bookmarkData)
      : null;
    const bookmarkData = resolved?.stale
      ? resolved.refreshedBookmarkData
      : source.link.accessGrant?.bookmarkData;
    if (resolved?.stale && !bookmarkData) throw new Error("The stale source bookmark could not be refreshed.");
    return {
      path: resolved?.path ?? source.link.lastKnownPath,
      ...(bookmarkData ? { bookmarkData } : {}),
      refreshed: Boolean(resolved)
    };
  }

  private async readAtLocation(
    source: LinkedSource,
    location: { path: string; bookmarkData?: string; refreshed: boolean }
  ): Promise<AvailableLinkedSourceView> {
    const stat = await this.dependencies.stat(location.path);
    if (source.resourceType === "file" && stat.size > MAX_SOURCE_VIEW_BYTES) {
      throw new Error("This source is too large for the read-only preview.");
    }
    const mediaType = source.resourceType === "folder" ? "text/plain" : sourceMediaType(source.name);
    const content = source.resourceType === "folder"
      ? await this.readSupportedFolder(location.path)
      : sourceContent(await this.dependencies.readFile(location.path), mediaType);
    return {
      sourceId: source.id,
      resourceType: source.resourceType,
      content,
      mediaType,
      fingerprint: fingerprint(stat, source.resourceType === "folder" ? content : undefined),
      ...(location.refreshed ? {
        linkRefresh: {
          lastKnownPath: location.path,
          canonicalPath: await this.dependencies.realpath(location.path),
          accessGrant: location.bookmarkData
            ? { kind: "securityScopedBookmark" as const, bookmarkData: location.bookmarkData }
            : null
        }
      } : {})
    };
  }

  private async readSupportedFolder(rootPath: string): Promise<string> {
    const files = await this.readBoundedFolderFiles(
      rootPath,
      (name) => sourceMediaType(name) === "text/plain",
      "This folder's supported files are too large for the read-only preview."
    );
    return files.map((file) => `--- ${file.path} ---\n${file.content.toString("utf8")}`).join("\n\n");
  }

  private async readBoundedFolderFiles(
    rootPath: string,
    include: (name: string) => boolean,
    tooLargeMessage: string
  ): Promise<Array<{ path: string; content: Buffer }>> {
    const canonicalRoot = await this.dependencies.realpath(rootPath);
    const files: Array<{ path: string; content: Buffer }> = [];
    const visitedDirectories = new Set<string>();
    let totalBytes = 0;
    const visit = async (directoryPath: string): Promise<void> => {
      const canonicalDirectory = await this.dependencies.realpath(directoryPath);
      if (visitedDirectories.has(canonicalDirectory)) return;
      visitedDirectories.add(canonicalDirectory);
      for (const name of (await this.dependencies.readdir(directoryPath)).sort()) {
        const candidatePath = join(directoryPath, name);
        const canonicalPath = await this.dependencies.realpath(candidatePath);
        const relativePath = relative(canonicalRoot, canonicalPath);
        if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) continue;
        const stat = await this.dependencies.stat(canonicalPath);
        if (stat.isDirectory()) {
          await visit(canonicalPath);
          continue;
        }
        if (!stat.isFile() || !include(name)) continue;
        totalBytes += stat.size;
        if (totalBytes > MAX_SOURCE_VIEW_BYTES) throw new Error(tooLargeMessage);
        files.push({ path: relativePath, content: await this.dependencies.readFile(canonicalPath) });
      }
    };
    await visit(canonicalRoot);
    return files;
  }

  private async describePath(
    path: string,
    resourceType: "file" | "folder",
    bookmarkData?: string
  ): Promise<SelectedLocalSource> {
    const stat = await this.dependencies.stat(path);
    if (resourceType === "file" ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(resourceType === "file" ? "Choose an existing file." : "Choose an existing folder.");
    }
    return {
      name: basename(path) || path,
      resourceType,
      lastKnownPath: path,
      canonicalPath: await this.dependencies.realpath(path),
      accessGrant: bookmarkData
        ? { kind: "securityScopedBookmark", bookmarkData }
        : null,
      fingerprint: fingerprint(stat, resourceType === "folder" ? await this.readSupportedFolder(path) : undefined)
    };
  }
}

const EMPTY_THUMBNAIL_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==";

function textSourceIndexExtraction(
  content: string,
  thumbnailDataUrl: string
): SourceIndexExtraction {
  let pageStartOffset = 0;
  return {
    extractionMethod: "embeddedText",
    pages: content.split("\f").map((pageText, pageIndex) => {
      const lines = [...pageText.matchAll(/[^\r\n]+/g)];
      const lineHeight = 1 / Math.max(lines.length, 1);
      const regions = lines.flatMap((lineMatch, lineIndex) => {
        const line = lineMatch[0];
        const trimmed = line.trim();
        const leadingWhitespace = line.indexOf(trimmed);
        const startOffset = pageStartOffset + lineMatch.index + Math.max(leadingWhitespace, 0);
        if (!trimmed) return [];
        const bounds = {
          x: 0.05,
          y: lineIndex * lineHeight,
          width: 0.9,
          height: Math.min(lineHeight, 0.08)
        };
        const offsets = { sourceStartOffset: startOffset, sourceEndOffset: startOffset + trimmed.length };
        const textRegion = { kind: "text" as const, text: trimmed, bounds, ...offsets };
        const equations = [...trimmed.matchAll(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g)].map((match) => {
          const equationStart = match.index;
          const equationWidth = Math.max(0.03, Math.min(0.9, match[0].length / Math.max(trimmed.length, 1) * 0.9));
          return {
            kind: "equation" as const,
            text: match[0],
            bounds: {
              x: Math.min(0.95 - equationWidth, 0.05 + equationStart / Math.max(trimmed.length, 1) * 0.9),
              y: bounds.y,
              width: equationWidth,
              height: bounds.height
            },
            ...({
              sourceStartOffset: startOffset + equationStart,
              sourceEndOffset: startOffset + equationStart + match[0].length
            })
          };
        });
        return [textRegion, ...equations];
      });
      pageStartOffset += pageText.length + 1;
      return {
        pageNumber: pageIndex + 1,
        width: 1000,
        height: 1400,
        thumbnailDataUrl,
        regions
      };
    })
  };
}

function fingerprint(stat: FileStat, content?: string): SourceFingerprint {
  return {
    size: stat.size,
    modifiedAtMs: stat.mtimeMs,
    ...(content === undefined ? {} : { contentHash: createHash("sha256").update(content).digest("hex") })
  };
}

function sameFingerprint(left: SourceFingerprint, right: SourceFingerprint): boolean {
  return left.size === right.size && left.modifiedAtMs === right.modifiedAtMs
    && left.contentHash === right.contentHash;
}

function sourceMediaType(name: string): AvailableLinkedSourceView["mediaType"] {
  switch (extname(name).toLocaleLowerCase()) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".txt":
    case ".md":
    case ".tex":
    case ".lean":
    case ".csv": return "text/plain";
    default: return "application/octet-stream";
  }
}

function sourceContent(content: Buffer, mediaType: AvailableLinkedSourceView["mediaType"]): string {
  return mediaType === "text/plain"
    ? content.toString("utf8")
    : `data:${mediaType};base64,${content.toString("base64")}`;
}
