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
const MAX_SOURCE_INDEX_PAGES = 256;
const MAX_SOURCE_INDEX_REGIONS = 100_000;

interface FileStat {
  size: number;
  mtimeMs: number;
  dev?: number | bigint;
  ino?: number | bigint;
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
  openFile(path: string): Promise<{
    stat(): Promise<FileStat>;
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
  readdir(path: string): Promise<string[]>;
  startAccessingSecurityScopedResource(bookmarkData: string): () => void;
  resolveSecurityScopedBookmark?(bookmarkData: string): Promise<{
    path: string;
    stale: boolean;
    refreshedBookmarkData?: string;
  } | null>;
  extractDocument?(content: Buffer, sourceName: string): Promise<unknown>;
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
    const bookmarkData = result.bookmarks?.[0];
    const stopAccess = bookmarkData ? this.dependencies.startAccessingSecurityScopedResource(bookmarkData) : null;
    try {
      return await this.describePath(result.filePaths[0], resourceType, bookmarkData);
    } finally {
      stopAccess?.();
    }
  }

  async selectDirectPath(path: string, resourceType: "file" | "folder"): Promise<SelectedLocalSource> {
    return this.describePath(path, resourceType);
  }

  async read(source: LinkedSource): Promise<AvailableLinkedSourceView> {
    const unresolvedLocation = await this.resolveSourceLocation(source);
    const stopAccess = unresolvedLocation.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(unresolvedLocation.bookmarkData)
      : null;
    try {
      const location = await this.canonicalizeSourceLocation(source, unresolvedLocation);
      return (await this.readAtLocation(source, location)).view;
    } finally {
      stopAccess?.();
    }
  }

  async extractForIndex(source: LinkedSource): Promise<SourceIndexExtractionResult> {
    const unresolvedLocation = await this.resolveSourceLocation(source);
    const stopAccess = unresolvedLocation.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(unresolvedLocation.bookmarkData)
      : null;
    try {
      const location = await this.canonicalizeSourceLocation(source, unresolvedLocation);
      const opened = await this.readAtLocation(source, location);
      const view = opened.view;
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
        extraction = validatedSourceIndexExtraction(
          await this.dependencies.extractDocument(opened.fileContent!, source.name)
        );
      } else {
        extraction = textSourceIndexExtraction(view.content, EMPTY_THUMBNAIL_DATA_URL);
      }
      requireBoundedSourceIndexExtraction(extraction);
      const afterExtraction = (await this.readAtLocation(source, location)).view;
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
    const unresolvedLocation = await this.resolveSourceLocation(source);
    const stopAccess = unresolvedLocation.bookmarkData
      ? this.dependencies.startAccessingSecurityScopedResource(unresolvedLocation.bookmarkData)
      : null;
    try {
      const location = await this.canonicalizeSourceLocation(source, unresolvedLocation);
      const opened = await this.readAtLocation(source, location);
      const view = opened.view;
      if (source.resourceType === "file") {
        return {
          mediaType: view.mediaType,
          contentBase64: opened.fileContent!.toString("base64"),
          fingerprint: view.fingerprint,
          ...(view.linkRefresh ? { linkRefresh: view.linkRefresh } : {})
        };
      }
      const revision = await this.readSupportedFolderRevision(location.path);
      const afterSnapshot = (await this.readAtLocation(source, location)).view;
      if (!sameFingerprint(view.fingerprint, afterSnapshot.fingerprint)) {
        throw new Error("This source changed while its Source Snapshot was being preserved. Retry after the source is stable.");
      }
      return {
        mediaType: "application/vnd.quick-study.folder-snapshot+json" as const,
        contentBase64: Buffer.from(JSON.stringify({
          format: "quick-study-folder-snapshot-v1",
          files: revision.files
        })).toString("base64"),
        fingerprint: view.fingerprint,
        ...(view.linkRefresh ? { linkRefresh: view.linkRefresh } : {})
      };
    } finally {
      stopAccess?.();
    }
  }

  private async resolveSourceLocation(source: LinkedSource): Promise<{
    path: string;
    lastKnownPath: string;
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
    const lastKnownPath = resolved?.path ?? source.link.lastKnownPath;
    return {
      path: lastKnownPath,
      lastKnownPath,
      ...(bookmarkData ? { bookmarkData } : {}),
      refreshed: Boolean(resolved)
    };
  }

  private async canonicalizeSourceLocation(
    source: LinkedSource,
    location: { path: string; lastKnownPath: string; bookmarkData?: string; refreshed: boolean }
  ): Promise<{ path: string; lastKnownPath: string; bookmarkData?: string; refreshed: boolean }> {
    const canonicalPath = await this.dependencies.realpath(location.path);
    if (!location.refreshed && canonicalPath !== source.link.canonicalPath) {
      throw new Error("This Linked Source no longer resolves to the learner-authorized object. Locate it again explicitly.");
    }
    return { ...location, path: canonicalPath };
  }

  private async readAtLocation(
    source: LinkedSource,
    location: { path: string; lastKnownPath: string; bookmarkData?: string; refreshed: boolean }
  ): Promise<{ view: AvailableLinkedSourceView; fileContent?: Buffer }> {
    const openedFile = source.resourceType === "file"
      ? await this.readIdentityBoundFile(location.path)
      : null;
    const stat = openedFile?.stat ?? await this.dependencies.stat(location.path);
    if (source.resourceType === "file" && stat.size > MAX_SOURCE_VIEW_BYTES) {
      throw new Error("This source is too large for the read-only preview.");
    }
    const mediaType = source.resourceType === "folder" ? "text/plain" : sourceMediaType(source.name);
    const folderRevision = source.resourceType === "folder"
      ? await this.readSupportedFolderRevision(location.path)
      : null;
    const content = folderRevision?.preview ?? sourceContent(openedFile!.content, mediaType);
    return { view: {
      sourceId: source.id,
      resourceType: source.resourceType,
      content,
      mediaType,
      fingerprint: fingerprint(stat, folderRevision?.fingerprintContent ?? openedFile?.content),
      ...(location.refreshed ? {
        linkRefresh: {
          lastKnownPath: location.lastKnownPath,
          canonicalPath: location.path,
          accessGrant: location.bookmarkData
            ? { kind: "securityScopedBookmark" as const, bookmarkData: location.bookmarkData }
            : null
        }
      } : {})
    }, ...(openedFile ? { fileContent: openedFile.content } : {}) };
  }

  private async readIdentityBoundFile(path: string): Promise<{ content: Buffer; stat: FileStat }> {
    const handle = await this.dependencies.openFile(path);
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error("This Linked Source is no longer a regular file.");
      if (before.size > MAX_SOURCE_VIEW_BYTES) {
        throw new Error("This source is too large for the read-only preview.");
      }
      const currentCanonicalPath = await this.dependencies.realpath(path);
      if (currentCanonicalPath !== path) {
        throw new Error("This Linked Source changed while it was being opened. Retry after the source is stable.");
      }
      const current = await this.dependencies.stat(currentCanonicalPath);
      if (!sameFileIdentity(before, current)) {
        throw new Error("This Linked Source changed while it was being opened. Retry after the source is stable.");
      }
      const chunks: Buffer[] = [];
      let position = 0;
      while (position <= MAX_SOURCE_VIEW_BYTES) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SOURCE_VIEW_BYTES + 1 - position));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
        if (bytesRead === 0) break;
        chunks.push(chunk.subarray(0, bytesRead));
        position += bytesRead;
      }
      if (position > MAX_SOURCE_VIEW_BYTES) {
        throw new Error("This source is too large for the read-only preview.");
      }
      const content = Buffer.concat(chunks, position);
      const after = await handle.stat();
      if (!sameFingerprint(fingerprint(before), fingerprint(after))) {
        throw new Error("This source changed while it was being read. Retry after the source is stable.");
      }
      return { content, stat: after };
    } finally {
      await handle.close();
    }
  }

  private async readSupportedFolderRevision(rootPath: string): Promise<{
    preview: string;
    fingerprintContent: string;
    files: Array<{ path: string; contentBase64: string }>;
  }> {
    const files = await this.readBoundedFolderFiles(
      rootPath,
      (name) => sourceMediaType(name) !== "application/octet-stream",
      "This folder's supported files are too large for the read-only preview."
    );
    const snapshotFiles = files.map((file) => ({ path: file.path, contentBase64: file.content.toString("base64") }));
    return {
      preview: files.filter((file) => sourceMediaType(file.path) === "text/plain")
        .map((file) => `--- ${file.path} ---\n${file.content.toString("utf8")}`).join("\n\n"),
      fingerprintContent: JSON.stringify(snapshotFiles),
      files: snapshotFiles
    };
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
        const openedFile = await this.readIdentityBoundFile(canonicalPath);
        totalBytes += openedFile.content.byteLength;
        if (totalBytes > MAX_SOURCE_VIEW_BYTES) throw new Error(tooLargeMessage);
        files.push({ path: relativePath, content: openedFile.content });
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
    const canonicalPath = await this.dependencies.realpath(path);
    const openedFile = resourceType === "file" ? await this.readIdentityBoundFile(canonicalPath) : null;
    const stat = openedFile?.stat ?? await this.dependencies.stat(canonicalPath);
    if (resourceType === "file" ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(resourceType === "file" ? "Choose an existing file." : "Choose an existing folder.");
    }
    return {
      name: basename(path) || path,
      resourceType,
      lastKnownPath: path,
      canonicalPath,
      accessGrant: bookmarkData
        ? { kind: "securityScopedBookmark", bookmarkData }
        : null,
      fingerprint: fingerprint(stat, resourceType === "folder"
        ? (await this.readSupportedFolderRevision(canonicalPath)).fingerprintContent
        : openedFile?.content)
    };
  }
}

function requireBoundedSourceIndexExtraction(extraction: SourceIndexExtraction): void {
  const regionCount = extraction.pages.reduce((total, page) => total + page.regions.length, 0);
  if (extraction.pages.length > MAX_SOURCE_INDEX_PAGES || regionCount > MAX_SOURCE_INDEX_REGIONS) {
    throw new Error("This source is too complex to index safely. Choose a smaller document or split it into parts.");
  }
}

function validatedSourceIndexExtraction(value: unknown): SourceIndexExtraction {
  if (!isRecord(value) || !["embeddedText", "pdfText", "ocr"].includes(String(value.extractionMethod))
    || !Array.isArray(value.pages)) {
    throw new Error("The native source extractor returned an invalid response.");
  }
  const pages = value.pages.map((page) => {
    if (!isRecord(page) || !Number.isInteger(page.pageNumber) || (page.pageNumber as number) < 1
      || !positiveFinite(page.width) || !positiveFinite(page.height)
      || typeof page.thumbnailDataUrl !== "string" || !page.thumbnailDataUrl.startsWith("data:image/png;base64,")
      || !Array.isArray(page.regions)) {
      throw new Error("The native source extractor returned an invalid response.");
    }
    return {
      pageNumber: page.pageNumber as number,
      width: page.width as number,
      height: page.height as number,
      thumbnailDataUrl: page.thumbnailDataUrl,
      regions: page.regions.map((region) => {
        if (!isRecord(region) || (region.kind !== "text" && region.kind !== "equation")
          || typeof region.text !== "string" || !validBounds(region.bounds)
          || !validSourceOffsets(region.sourceStartOffset, region.sourceEndOffset)) {
          throw new Error("The native source extractor returned an invalid response.");
        }
        return {
          kind: region.kind as "text" | "equation",
          text: region.text,
          bounds: region.bounds,
          ...(region.sourceStartOffset === undefined ? {} : {
            sourceStartOffset: region.sourceStartOffset as number,
            sourceEndOffset: region.sourceEndOffset as number
          })
        };
      })
    };
  });
  if (new Set(pages.map((page) => page.pageNumber)).size !== pages.length) {
    throw new Error("The native source extractor returned an invalid response.");
  }
  return { extractionMethod: value.extractionMethod as SourceIndexExtraction["extractionMethod"], pages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) return false;
  const coordinates = [value.x, value.y, value.width, value.height];
  return coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && (value.x as number) >= 0 && (value.y as number) >= 0
    && (value.width as number) > 0 && (value.height as number) > 0
    && (value.x as number) + (value.width as number) <= 1
    && (value.y as number) + (value.height as number) <= 1;
}

function validSourceOffsets(start: unknown, end: unknown): boolean {
  return (start === undefined && end === undefined)
    || (Number.isInteger(start) && Number.isInteger(end) && (start as number) >= 0 && (end as number) > (start as number));
}

const EMPTY_THUMBNAIL_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==";

function textSourceIndexExtraction(
  content: string,
  thumbnailDataUrl: string
): SourceIndexExtraction {
  let pageStartOffset = 0;
  let regionCount = 0;
  const pageTexts = content.split("\f");
  if (pageTexts.length > MAX_SOURCE_INDEX_PAGES) {
    throw new Error("This source is too complex to index safely. Choose a smaller document or split it into parts.");
  }
  return {
    extractionMethod: "embeddedText",
    pages: pageTexts.map((pageText, pageIndex) => {
      let lineCount = 0;
      for (const _line of pageText.matchAll(/[^\r\n]+/g)) lineCount += 1;
      const lineHeight = 1 / Math.max(lineCount, 1);
      const regions: SourceIndexExtraction["pages"][number]["regions"] = [];
      let lineIndex = 0;
      for (const lineMatch of pageText.matchAll(/[^\r\n]+/g)) {
        const line = lineMatch[0];
        const trimmed = line.trim();
        const leadingWhitespace = line.indexOf(trimmed);
        const startOffset = pageStartOffset + lineMatch.index + Math.max(leadingWhitespace, 0);
        if (!trimmed) continue;
        const bounds = {
          x: 0.05,
          y: lineIndex * lineHeight,
          width: 0.9,
          height: Math.min(lineHeight, 0.08)
        };
        const offsets = { sourceStartOffset: startOffset, sourceEndOffset: startOffset + trimmed.length };
        const textRegion = { kind: "text" as const, text: trimmed, bounds, ...offsets };
        regionCount += 1;
        if (regionCount > MAX_SOURCE_INDEX_REGIONS) {
          throw new Error("This source is too complex to index safely. Choose a smaller document or split it into parts.");
        }
        regions.push(textRegion);
        for (const match of trimmed.matchAll(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g)) {
          const equationStart = match.index;
          const equationWidth = Math.max(0.03, Math.min(0.9, match[0].length / Math.max(trimmed.length, 1) * 0.9));
          regionCount += 1;
          if (regionCount > MAX_SOURCE_INDEX_REGIONS) {
            throw new Error("This source is too complex to index safely. Choose a smaller document or split it into parts.");
          }
          regions.push({
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
          });
        }
        lineIndex += 1;
      }
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

function fingerprint(stat: FileStat, content?: string | Buffer): SourceFingerprint {
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

function sameFileIdentity(left: FileStat, right: FileStat): boolean {
  if (left.dev !== undefined && left.ino !== undefined && right.dev !== undefined && right.ino !== undefined) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.isFile() === right.isFile() && left.isDirectory() === right.isDirectory();
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
