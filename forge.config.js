const { chmod, copyFile, readdir, rm } = require("node:fs/promises");
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
    beforeCopyExtraResources: [copyPackagedUpstreamNotices],
    extraResource: ["dist/verifiers", "LICENSE.md", "NOTICE", "THIRD_PARTY_NOTICES.md"],
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

function copyPackagedUpstreamNotices(outputPath, _electronVersion, _platform, _arch, done) {
  copyPackagedUpstreamNoticesAsync(outputPath).then(() => done(), done);
}

async function copyPackagedUpstreamNoticesAsync(outputPath) {
  const resources = join(outputPath, "Quick Study.app", "Contents", "Resources");
  const notices = [
    {
      sources: [
        join(outputPath, "LICENSE"),
        join(outputPath, "Quick Study.app", "LICENSE"),
        join(outputPath, "Quick Study.app", "Contents", "LICENSE"),
        join(__dirname, "node_modules", "electron", "dist", "LICENSE"),
      ],
      destination: join(resources, "ELECTRON_LICENSE"),
    },
    {
      sources: [
        join(outputPath, "LICENSES.chromium.html"),
        join(outputPath, "Quick Study.app", "LICENSES.chromium.html"),
        join(outputPath, "Quick Study.app", "Contents", "LICENSES.chromium.html"),
        join(__dirname, "node_modules", "electron", "dist", "LICENSES.chromium.html"),
      ],
      destination: join(resources, "CHROMIUM_LICENSES.html"),
    },
  ];
  for (const notice of notices) await copyFirstAvailableFile(notice.sources, notice.destination);
}

async function copyFirstAvailableFile(sources, destination) {
  for (const source of sources) {
    try {
      await copyFile(source, destination);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Could not find an upstream notice to copy to ${destination}.`);
}

async function makeVerifierFilesReadOnly(directory) {
  await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeVerifierFilesReadOnly(path);
    else await chmod(path, path.endsWith(join("bin", "lean")) ? 0o555 : 0o444);
  }));
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
