import { lstat, mkdtemp, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareModelRuntimeWorkspace, prepareModelRuntimeWorkspaceOrNull } from "./model-runtime-workspace";

describe("Model Runtime workspace", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("rejects relative configured roots before filesystem access", async () => {
    await expect(prepareModelRuntimeWorkspace("relative-state", "/temporary"))
      .rejects.toThrow("absolute child path");
  });

  it("creates a private empty workspace outside durable application state", async () => {
    const root = await mkdtemp(join(tmpdir(), "quick-study-runtime-boundary-test-"));
    directories.push(root);
    const dataDirectory = join(root, "application-state");
    const temporaryDirectory = join(root, "temporary");
    await mkdir(dataDirectory);
    await mkdir(temporaryDirectory);
    await writeFile(join(dataDirectory, "learning-application.json"), "PRIVATE_PERSONAL_NOTE", "utf8");

    const workspace = await prepareModelRuntimeWorkspace(dataDirectory, temporaryDirectory);

    const canonicalData = await realpath(dataDirectory);
    const canonicalWorkspace = await realpath(workspace);
    const pathFromData = relative(canonicalData, canonicalWorkspace);
    expect(pathFromData === "" || (!pathFromData.startsWith(`..${sep}`) && pathFromData !== "..")).toBe(false);
    expect((await lstat(workspace)).isDirectory()).toBe(true);
    expect((await lstat(workspace)).mode & 0o077).toBe(0);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("degrades to local-only mode when the private runtime workspace cannot be prepared", async () => {
    const failure = new Error("temporary volume unavailable");
    const observe = vi.fn();

    await expect(prepareModelRuntimeWorkspaceOrNull(
      "/application-state", "/temporary", observe, async () => { throw failure; }
    )).resolves.toBeNull();
    expect(observe).toHaveBeenCalledWith(failure);
  });
});
