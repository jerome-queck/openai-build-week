const { chmod, readdir, rm } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = {
  packagerConfig: {
    appBundleId: "com.jeromequeck.quick-study",
    appCategoryType: "public.app-category.education",
    asar: { unpackDir: "dist/helpers" },
    icon: undefined,
    osxSign: {
      identity: "-",
      identityValidation: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
      continueOnError: false
    },
    extraResource: ["dist/verifiers", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"],
    ignore: [
      /^\/src($|\/)/,
      /^\/tests($|\/)/,
      /^\/test-results($|\/)/,
      /^\/docs($|\/)/,
      /^\/native($|\/)/,
      /^\/scripts($|\/)/,
      /^\/dist\/verifiers($|\/)/,
      /^\/prototype($|\/)/,
      /^\/.agents($|\/)/,
      /^\/.claude($|\/)/,
      /^\/.github($|\/)/,
      /^\/node_modules\/.cache($|\/)/,
      /^\/out($|\/)/
    ]
  },
  makers: [{
    name: "@electron-forge/maker-zip",
    platforms: ["darwin"]
  }],
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
      await removeMetadataFiles(join(__dirname, "dist", "verifiers"));
      const priorVerifierDirectory = join(__dirname, "out", `Quick Study-${platform}-${arch}`,
        "Quick Study.app", "Contents", "Resources", "verifiers");
      await makeVerifierFilesWritable(priorVerifierDirectory);
    },
    postPackage: async (_forgeConfig, packageResult) => {
      for (const outputPath of packageResult.outputPaths) {
        await makeVerifierFilesReadOnly(join(outputPath, "Quick Study.app", "Contents", "Resources", "verifiers"));
      }
    }
  }
};

async function makeVerifierFilesReadOnly(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeVerifierFilesReadOnly(path);
    else await chmod(path, path.endsWith(join("bin", "lean")) ? 0o555 : 0o444);
  }
  await chmod(directory, 0o555);
}

async function makeVerifierFilesWritable(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await chmod(directory, 0o755);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeVerifierFilesWritable(path);
  }
}

async function removeMetadataFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeMetadataFiles(path);
    else if (entry.name === ".DS_Store") await rm(path, { force: true });
  }
}
