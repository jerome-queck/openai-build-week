import { chmod, mkdir, mkdtemp, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export async function prepareModelRuntimeWorkspace(
  dataDirectory: string,
  temporaryDirectory: string
): Promise<string> {
  const normalizedDataDirectory = normalizedChildPath(dataDirectory, "application data");
  const normalizedTemporaryDirectory = normalizedChildPath(temporaryDirectory, "temporary files");
  await mkdir(normalizedDataDirectory, { recursive: true });
  await mkdir(normalizedTemporaryDirectory, { recursive: true });
  // Canonicalizing the configured application data root is the containment control.
  const canonicalDataDirectory = await realpath(normalizedDataDirectory);
  const canonicalTemporaryDirectory = await realpath(normalizedTemporaryDirectory);
  if (isWithin(canonicalDataDirectory, canonicalTemporaryDirectory)) {
    throw new Error("The Model Runtime workspace must be outside durable application state.");
  }
  const workspace = await mkdtemp(join(canonicalTemporaryDirectory, "clarifold-model-runtime-"));
  await chmod(workspace, 0o700);
  return workspace;
}

function normalizedChildPath(candidate: string, label: string): string {
  if (!isAbsolute(candidate)) {
    throw new Error(`The configured ${label} path must identify an absolute child path.`);
  }
  const normalized = resolve(candidate);
  const parent = dirname(normalized);
  if (normalized === parent || !normalized.startsWith(`${parent}${sep}`)) {
    throw new Error(`The configured ${label} path must identify an absolute child path.`);
  }
  return normalized;
}

export async function prepareModelRuntimeWorkspaceOrNull(
  dataDirectory: string,
  temporaryDirectory: string,
  onFailure: (error: unknown) => void = (error) => console.error("Model Runtime workspace unavailable:", error),
  prepare: typeof prepareModelRuntimeWorkspace = prepareModelRuntimeWorkspace
): Promise<string | null> {
  try {
    return await prepare(dataDirectory, temporaryDirectory);
  } catch (error) {
    onFailure(error);
    return null;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
}
