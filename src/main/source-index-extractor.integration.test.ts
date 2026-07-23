import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("native Source Index extraction budget", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("rejects a PDF over the page budget before retaining extracted pages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quick-study-source-budget-test-"));
    directories.push(directory);
    const sourcePath = join(directory, "257-pages.pdf");
    const fixture = spawnSync("/usr/bin/xcrun", [
      "swift", join(process.cwd(), "tests/fixtures/create-scanned-pdf.swift"), sourcePath, "257"
    ], { encoding: "utf8", timeout: 30_000 });
    expect(fixture.status, fixture.stderr).toBe(0);

    const extraction = spawnSync("/usr/bin/xcrun", [
      "swift", join(process.cwd(), "native/source-index-extractor.swift"), sourcePath
    ], { encoding: "utf8", timeout: 30_000 });

    expect(extraction.status).toBe(1);
    expect(extraction.stdout).toBe("");
    expect(extraction.stderr).toContain("too complex to index safely");
  }, 60_000);
});
