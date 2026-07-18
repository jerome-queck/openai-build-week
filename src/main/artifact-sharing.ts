import { BrowserWindow, ShareMenu } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactPortableCopy,
  ArtifactShareResult,
  ArtifactSharing
} from "../shared/learning-application";

export class MacOsArtifactSharing implements ArtifactSharing {
  constructor(private readonly temporaryDirectory: string) {}

  async share(copy: ArtifactPortableCopy): Promise<ArtifactShareResult> {
    const shareDirectory = join(this.temporaryDirectory, "quick-study-artifact-shares", randomUUID());
    await mkdir(shareDirectory, { recursive: true });
    const sharePath = join(shareDirectory, copy.suggestedFilename);
    await writeFile(sharePath, copy.content, "utf8");
    const shareMenu = new ShareMenu({ filePaths: [sharePath] });
    shareMenu.popup({ window: BrowserWindow.getFocusedWindow() ?? undefined });
    return { status: "shared", path: sharePath };
  }
}
