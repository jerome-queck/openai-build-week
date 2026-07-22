import { randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export interface AtomicFileWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  stagingSuffix?: string;
  uniqueId?(): string;
  beforeRename?(stagingPath: string): Promise<void>;
}

export async function atomicWriteFile(
  destinationPath: string,
  content: string | Buffer,
  options: AtomicFileWriteOptions = {}
): Promise<void> {
  if (!isAbsolute(destinationPath)) {
    throw new Error("The atomic destination must identify an absolute child path.");
  }
  const normalizedDestinationPath = resolve(destinationPath);
  const destinationDirectory = dirname(normalizedDestinationPath);
  if (
    normalizedDestinationPath === destinationDirectory
    || !normalizedDestinationPath.startsWith(`${destinationDirectory}${sep}`)
  ) {
    throw new Error("The atomic destination must identify an absolute child path.");
  }
  const uniqueId = options.uniqueId?.() ?? randomUUID();
  const stagingPath = `${normalizedDestinationPath}.${uniqueId}${options.stagingSuffix ?? ".temporary"}`;
  // Callers supply a managed or explicitly learner-selected destination boundary.
  const handle = await open(stagingPath, "wx", options.mode ?? 0o600);
  const stagedIdentity = await handle.stat();
  try {
    if (typeof content === "string") await handle.writeFile(content, { encoding: options.encoding ?? "utf8" });
    else await handle.writeFile(content);
    await handle.sync();
    await options.beforeRename?.(stagingPath);
    // Identity check of the exclusively created staging path.
    const stagedPathIdentity = await lstat(stagingPath);
    if (!sameFileIdentity(stagedIdentity, stagedPathIdentity)) {
      throw new Error("The atomic staging file changed before publication.");
    }
    // Atomic publication within the caller-authorized destination boundary.
    await rename(stagingPath, normalizedDestinationPath);
    // Post-publication identity verification of that same boundary.
    const publishedIdentity = await lstat(normalizedDestinationPath);
    if (!sameFileIdentity(stagedIdentity, publishedIdentity)) {
      throw new Error("The atomic staging file changed before publication.");
    }
  } catch (error) {
    // Cleanup is gated by owned inode identity.
    const currentStagingIdentity = await lstat(stagingPath).catch(() => null);
    if (currentStagingIdentity && sameFileIdentity(stagedIdentity, currentStagingIdentity)) {
      // Only removes the still-owned staging inode.
      await rm(stagingPath, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    await handle.close();
  }
}

function sameFileIdentity(
  expected: { dev: number; ino: number },
  actual: { dev: number; ino: number }
): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}
