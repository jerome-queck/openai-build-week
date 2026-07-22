import { lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "./atomic-file";

describe("atomicWriteFile", () => {
  const directories: string[] = [];

  afterEach(async () => Promise.all(directories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true }))));

  it("rejects relative destinations before opening a filesystem path", async () => {
    await expect(atomicWriteFile("relative/state.json", "state"))
      .rejects.toThrow("absolute child path");
  });

  it("fails publication if the exclusively created staging object is swapped before rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quick-study-atomic-file-test-"));
    directories.push(directory);
    const destination = join(directory, "state.json");
    const outside = join(directory, "outside.json");
    await writeFile(outside, "outside must remain unchanged", "utf8");
    await writeFile(destination, "last known-good state", "utf8");

    await expect(atomicWriteFile(destination, "trusted state", {
      encoding: "utf8",
      uniqueId: () => "controlled",
      beforeRename: async (stagingPath) => {
        await unlink(stagingPath);
        await symlink(outside, stagingPath);
      }
    })).rejects.toThrow("staging file changed");

    expect(await readFile(outside, "utf8")).toBe("outside must remain unchanged");
    expect(await readFile(destination, "utf8")).toBe("last known-good state");
    expect((await lstat(`${destination}.controlled.temporary`)).isSymbolicLink()).toBe(true);
  });
});
