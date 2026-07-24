import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ALWAYS_REQUIRED_SURFACES = [
  "lint",
  "typecheck",
  "unit",
  "documentation-policy",
  "change-classification",
  "security",
];

const DOCUMENTATION_PATHS = [
  /^\.github\/(?:ISSUE_TEMPLATE|pull_request_template\.md)/,
  /^docs\//,
  /^evaluation\/README\.md$/,
  /^(?:README|CONTRIBUTING|CODING_STANDARDS|CONTEXT|AGENTS)\.md$/,
  /^(?:LICENSE|NOTICE)(?:\.|$)/,
  /^\.(?:editorconfig|gitattributes|gitignore|mailmap)$/,
];

const TEST_PATHS = [
  /^src\/.*\.test\.(?:ts|tsx)$/,
  /^tests\/.*\.test\.(?:ts|tsx)$/,
  /^vitest\.config\.[cm]?[jt]s$/,
];

const ARTIFACT_PATHS = [
  /^src\//,
  /^native\//,
  /^tests\//,
  /^build\//,
  /^public\//,
  /^assets\//,
  /^scripts\//,
  /^evaluation\/(?:benchmarks|fixtures)\//,
  /^\.github\/workflows\//,
  /^\.github\/dependabot\.yml$/,
  /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json)$/,
  /^(?:forge\.config|vite\.config|electron-builder\.yml)\./,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^\.npmrc$/,
];

function matchesAny(patterns, changedPath) {
  return patterns.some((pattern) => pattern.test(changedPath));
}

function validateChangedPath(changedPath) {
  if (
    typeof changedPath !== "string" ||
    changedPath.length === 0 ||
    changedPath.startsWith("/") ||
    changedPath.includes("\\") ||
    changedPath.includes("\0") ||
    path.posix.normalize(changedPath) !== changedPath ||
    changedPath.split("/").includes("..")
  ) {
    throw new Error("Changed paths must be non-empty relative paths");
  }
}

export function classifyChangedPaths(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error("Changed paths must be a non-empty array");
  }

  const categories = changedPaths.map((changedPath) => {
    validateChangedPath(changedPath);

    if (matchesAny(TEST_PATHS, changedPath)) {
      return "test";
    }
    if (matchesAny(ARTIFACT_PATHS, changedPath)) {
      return "artifact";
    }
    if (matchesAny(DOCUMENTATION_PATHS, changedPath)) {
      return "documentation";
    }

    throw new Error(`Unclassified changed path: ${changedPath}`);
  });

  const artifactAffected = categories.includes("artifact");
  let classification = "non-artifact";
  if (artifactAffected) {
    classification = "artifact-affecting";
  } else if (categories.every((category) => category === "documentation")) {
    classification = "documentation-only";
  } else if (categories.every((category) => category === "test")) {
    classification = "tests-only";
  }

  return {
    classification,
    artifactAffected,
    changedPaths: [...changedPaths],
    selectedSurfaces: artifactAffected
      ? [...ALWAYS_REQUIRED_SURFACES, "packaged"]
      : [...ALWAYS_REQUIRED_SURFACES],
  };
}

export function classifyAllChanges() {
  return {
    classification: "full-repository",
    artifactAffected: true,
    changedPaths: ["<full repository>"],
    selectedSurfaces: [...ALWAYS_REQUIRED_SURFACES, "packaged"],
  };
}

function changedPathsFromGit(base, head) {
  try {
    const output = execFileSync("git", ["diff", "--no-renames", "--name-only", "--diff-filter=ACMRD", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const changedPaths = output.split("\n").filter(Boolean);
    if (changedPaths.length === 0) {
      throw new Error("No changed paths were found");
    }
    return changedPaths;
  } catch (error) {
    if (error instanceof Error && error.message === "No changed paths were found") {
      throw error;
    }
    throw new Error(`Unable to inspect changed paths: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printResult(result) {
  console.log(`Change classification: ${result.classification}`);
  console.log(`Changed paths: ${result.changedPaths.join(", ")}`);
  console.log(`Selected verification surfaces: ${result.selectedSurfaces.join(", ")}`);
  console.log(`Packaging required: ${result.artifactAffected}`);
  console.log(`github-output:classification=${result.classification}`);
  console.log(`github-output:artifact_affected=${result.artifactAffected}`);
  console.log(`github-output:verification_surfaces=${result.selectedSurfaces.join(",")}`);
}

function main() {
  const args = process.argv.slice(2);
  const result = args.includes("--all")
    ? classifyAllChanges()
    : (() => {
        const baseIndex = args.indexOf("--base");
        const headIndex = args.indexOf("--head");
        if (baseIndex < 0 || headIndex < 0 || !args[baseIndex + 1] || !args[headIndex + 1]) {
          throw new Error("Usage: node scripts/change-classifier.mjs --base <sha> --head <sha> | --all");
        }
        return classifyChangedPaths(changedPathsFromGit(args[baseIndex + 1], args[headIndex + 1]));
      })();

  printResult(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
