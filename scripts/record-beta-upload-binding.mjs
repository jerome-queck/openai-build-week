import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertRealFile } from "./release-integrity.mjs";

const root = process.cwd();
const artifactDigest = process.env.ARTIFACT_DIGEST;
const artifactName = process.env.ARTIFACT_NAME;
const candidateCommit = process.env.CANDIDATE_COMMIT;
if (!/^[a-f0-9]{64}$/.test(artifactDigest ?? "")
  || !/^[A-Za-z0-9-]+$/.test(artifactName ?? "")
  || !/^[a-f0-9]{40}$/.test(candidateCommit ?? "")) {
  throw new Error("The uploaded beta binding requires a valid artifact name, SHA-256, and candidate commit.");
}

const receiptPath = join(root, "test-results", "beta-install.json");
await assertRealFile(receiptPath, "installed beta receipt");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
if (receipt.candidateCommit !== candidateCommit
  || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? "")
  || typeof receipt.artifact !== "string") {
  throw new Error("The installed beta receipt does not match the uploaded candidate.");
}

const binding = {
  schemaVersion: 1,
  artifactName,
  artifactDigest,
  candidateCommit,
  uploadedInput: {
    name: receipt.artifact,
    sha256: receipt.sha256,
    receiptSha256: await fileDigest(receiptPath)
  }
};
await writeFile(
  join(root, "test-results", "beta-upload-binding.json"),
  `${JSON.stringify(binding, null, 2)}\n`,
  "utf8"
);

async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
