import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const version = "8.30.1";
const releases = {
  arm64: {
    archive: "gitleaks_8.30.1_darwin_arm64.tar.gz",
    sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
  },
  x64: {
    archive: "gitleaks_8.30.1_darwin_x64.tar.gz",
    sha256: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
  }
};
const release = releases[process.arch];
if (!release) throw new Error(`Gitleaks has no pinned macOS release for ${process.arch}.`);

const directory = await mkdtemp(join(tmpdir(), "clarifold-gitleaks-"));
const archivePath = join(directory, release.archive);
const binaryPath = join(directory, "gitleaks");
try {
  const response = await fetch(
    `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${release.archive}`
  );
  if (!response.ok) throw new Error(`Gitleaks download failed with HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== release.sha256) throw new Error("Downloaded Gitleaks archive failed its SHA-256 check.");
  await writeFile(archivePath, archive);
  await run("/usr/bin/tar", ["-xzf", archivePath, "-C", directory]);
  await chmod(binaryPath, 0o700);
  await run(binaryPath, [
    "detect",
    "--source",
    process.cwd(),
    "--redact",
    "--no-banner",
    "--log-opts=--all"
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}.`)));
  });
}
