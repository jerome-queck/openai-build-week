import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyChangedPaths } from "./change-classifier.mjs";
import { validateDocumentation, validatePublicIssueIntake } from "./check-documentation.mjs";

test("repository public issue intake matches the supported community boundary", async () => {
  assert.deepEqual(await validatePublicIssueIntake({ rootDir: process.cwd() }), []);
});

test("public issue intake policy accepts a compact complete fixture repository", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-issue-intake-valid-"));
  const templateDir = path.join(rootDir, ".github", "ISSUE_TEMPLATE");
  await mkdir(templateDir, { recursive: true });
  await writeFile(
    path.join(templateDir, "config.yml"),
    [
      "blank_issues_enabled: false",
      "contact_links:",
      "  - url: https://github.com/jerome-queck/clarifold/security/advisories/new",
      "  - url: security@jeromegroup.org",
      "  - url: mailto:conduct@jeromegroup.org",
      "  - url: mailto:privacy@jeromegroup.org",
      "  - url: mailto:licensing@jeromegroup.org",
      "",
    ].join("\n"),
  );

  const forms = [
    ["bug_report.yml", "Bug report", ["summary", "environment", "reproducible", "steps", "impact", "safe-to-publish"]],
    ["learning_experience.yml", "Learning experience proposal", ["learner-goal", "current-experience", "proposal", "impact", "safe-to-publish"]],
    ["mathematical_accuracy.yml", "Mathematical-accuracy concern", ["claim-location", "claim", "concern", "reasoning", "reproduction", "impact", "safe-to-publish"]],
    ["accessibility_usability.yml", "Accessibility or usability concern", ["barrier", "affected-journey", "reproduction", "environment", "impact", "safe-to-publish"]],
  ];
  for (const [file, name, ids] of forms) {
    await writeFile(
      path.join(templateDir, file),
      [
        `name: ${name}`,
        "description: A complete fixture form",
        "title: '[Fixture]: '",
        "labels: [needs-triage]",
        "body:",
        "  - type: markdown",
        "    id: public-warning",
        "    attributes:",
        "      value: private learner material secret security conduct best-effort",
        ...ids.flatMap((id) => [
          `  - type: ${id === "safe-to-publish" ? "checkboxes" : "input"}`,
          `    id: ${id}`,
          "    attributes:",
          "      label: Fixture",
        ]),
        "",
      ].join("\n"),
    );
  }

  assert.deepEqual(await validatePublicIssueIntake({ rootDir }), []);
});

test("public issue intake policy rejects an incomplete fixture repository", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-issue-intake-"));
  await mkdir(path.join(rootDir, ".github", "ISSUE_TEMPLATE"), { recursive: true });
  await writeFile(path.join(rootDir, ".github", "ISSUE_TEMPLATE", "config.yml"), "blank_issues_enabled: true\n");

  const errors = await validatePublicIssueIntake({ rootDir });

  assert.match(errors.join("\n"), /blank issues must be disabled/);
  assert.match(errors.join("\n"), /missing contact route/);
  assert.match(errors.join("\n"), /missing issue form: \.github\/ISSUE_TEMPLATE\/bug_report\.yml/);
});

test("classifies documentation-only changes without requiring packaging", () => {
  const result = classifyChangedPaths([
    "README.md",
    "CODE_OF_CONDUCT.md",
    "PRIVACY.md",
    "SECURITY.md",
    "LICENSE",
    "LICENSE.md",
    "docs/development.md",
    "THIRD_PARTY_NOTICES.md",
    ".mailmap",
  ]);

  assert.equal(result.classification, "documentation-only");
  assert.equal(result.artifactAffected, false);
  assert.deepEqual(result.selectedSurfaces, [
    "lint",
    "typecheck",
    "unit",
    "documentation-policy",
    "change-classification",
    "security",
  ]);
});

test("classifies runtime and workflow changes as packaging-affecting", () => {
  const result = classifyChangedPaths(["src/shared/learning-application.ts", ".github/workflows/macos-ci.yml"]);

  assert.equal(result.classification, "artifact-affecting");
  assert.equal(result.artifactAffected, true);
  assert.equal(result.selectedSurfaces.at(-1), "packaged");
});

test("keeps test-only changes out of the packaging lane", () => {
  const result = classifyChangedPaths(["src/shared/learning-application.test.ts", "tests/example.test.ts"]);

  assert.equal(result.classification, "tests-only");
  assert.equal(result.artifactAffected, false);
});

test("fails closed for an unknown path", () => {
  assert.throws(
    () => classifyChangedPaths(["generated-output/unknown.bin"]),
    /Unclassified changed path: generated-output\/unknown\.bin/,
  );
});

test("fails closed for classifier input errors", () => {
  assert.throws(() => classifyChangedPaths([""]), /Changed paths must be non-empty relative paths/);
});

test("documentation validation accepts valid links, anchors, and npm scripts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { verify: "true" } }));
  await writeFile(
    path.join(rootDir, "README.md"),
    "# Home\n\n[Guide](docs/guide.md#setup)\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n\n`npm run verify`\n",
  );
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "guide.md"), "# Guide\n\n## Setup\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".github", "pull_request_template.md"),
    "## Documentation impact\n\n## Security impact\n",
  );

  assert.deepEqual(await validateDocumentation({ rootDir }), []);
});

test("documentation validation rejects event-specific references in active files", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "AGENTS.md"), "This is an OpenAI Build Week submission.\n");
  await writeFile(path.join(rootDir, "forge.config.js"), "const repository = 'https://github.com/jerome-queck/openai-build-week';\n");
  await writeFile(path.join(rootDir, "vitest.config.ts"), "const event = 'Devpost';\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");

  const errors = await validateDocumentation({ rootDir });

  assert.match(errors.join("\n"), /AGENTS\.md: prohibited event-specific reference/);
  assert.match(errors.join("\n"), /forge\.config\.js: prohibited event-specific reference/);
  assert.match(errors.join("\n"), /vitest\.config\.ts: prohibited event-specific reference/);
});

test("documentation validation rejects unsafe ignore rules", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");
  await writeFile(path.join(rootDir, ".gitignore"), "node_modules/\npackage-lock.json\nevaluation/fixtures/\n");

  const errors = await validateDocumentation({ rootDir });

  assert.match(errors.join("\n"), /\.gitignore: missing required hygiene rule: \.env/);
  assert.match(errors.join("\n"), /\.gitignore: do not ignore package-lock\.json/);
  assert.match(errors.join("\n"), /\.gitignore: do not ignore shareable collaboration or fixture paths/);
});

test("documentation validation accepts answered pull-request declarations", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");

  const body = [
    "## Documentation impact",
    "- [x] Documentation is affected; the owning canonical document is updated in this PR.",
    "- [ ] Documentation is not affected; explain why: no contract changed.",
    "Documentation impact details: owner=docs/agents/engineering-workflow.md; docs/development.md.",
    "## Security impact",
    "- [ ] Security-sensitive code, data, dependency, workflow, packaging, or trust-boundary behavior is affected; describe the review route and evidence.",
    "- [x] Security impact is limited to none; explain why: documentation-only change.",
    "Security impact details: reason=documentation-only change; no sensitive boundary changed.",
  ].join("\n");

  assert.deepEqual(await validateDocumentation({ rootDir, pullRequestBody: body }), []);
});

test("documentation validation rejects trivial pull-request declaration details", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");

  const body = [
    "- [x] Documentation is affected",
    "- [ ] Documentation is not affected",
    "Documentation impact details: x",
    "- [ ] Security-sensitive code is affected",
    "- [x] Security impact is limited to none",
    "Security impact details: none",
  ].join("\n");
  const errors = await validateDocumentation({ rootDir, pullRequestBody: body });

  assert.deepEqual(errors.filter((error) => error.includes("provide")), [
    "pull request body: provide documentation-impact details",
    "pull request body: provide security-impact details",
  ]);
});

test("documentation validation rejects duplicate checked declaration options", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");

  const body = [
    "- [x] Documentation is affected",
    "- [x] Documentation is affected again",
    "- [ ] Documentation is not affected",
    "Documentation impact details: Updated docs/development.md.",
    "- [x] Security-sensitive code is affected",
    "- [x] Security-sensitive code is affected again",
    "- [ ] Security impact is limited to none",
    "Security impact details: Reviewed with evidence from tests and audit.",
  ].join("\n");
  const errors = await validateDocumentation({ rootDir, pullRequestBody: body });

  assert.deepEqual(errors.filter((error) => error.includes("select exactly one")), [
    "pull request body: select exactly one documentation-impact declaration",
    "pull request body: select exactly one security-impact declaration",
  ]);
});

test("documentation validation requires a security review route and evidence", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Development](docs/development.md)\n[Architecture](docs/architecture.md)\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "## Documentation impact\n\n## Security impact\n");

  const body = [
    "- [x] Documentation is affected",
    "- [ ] Documentation is not affected",
    "Documentation impact details: Updated docs/development.md.",
    "- [x] Security-sensitive code is affected",
    "- [ ] Security impact is limited to none",
    "Security impact details: Security test evidence.",
  ].join("\n");
  const errors = await validateDocumentation({ rootDir, pullRequestBody: body });

  assert.deepEqual(errors.filter((error) => error.includes("security-impact")), [
    "pull request body: provide security-impact details",
  ]);
});

test("documentation validation reports broken links, commands, and policy sections", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clarifold-docs-"));
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: {} }));
  await writeFile(path.join(rootDir, "README.md"), "# Home\n\n[Missing](missing.md#nope)\n\n`npm run absent`\n");
  await writeFile(path.join(rootDir, "CONTRIBUTING.md"), "# Contributing\n");
  await writeFile(path.join(rootDir, "CODING_STANDARDS.md"), "# Standards\n");
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await writeFile(path.join(rootDir, "docs", "development.md"), "# Development\n");
  await writeFile(path.join(rootDir, "docs", "architecture.md"), "# Architecture\n");
  await mkdir(path.join(rootDir, ".github"), { recursive: true });
  await writeFile(path.join(rootDir, ".github", "pull_request_template.md"), "# PR\n");

  const errors = await validateDocumentation({ rootDir });

  assert.match(errors.join("\n"), /README\.md: broken local link/);
  assert.match(errors.join("\n"), /README\.md: documented npm script does not exist: absent/);
  assert.match(errors.join("\n"), /pull_request_template\.md: missing required section: Documentation impact/);
  assert.match(errors.join("\n"), /pull_request_template\.md: missing required section: Security impact/);
  assert.match(errors.join("\n"), /README\.md: missing canonical documentation link: docs\/development\.md/);
  assert.match(errors.join("\n"), /README\.md: missing canonical documentation link: docs\/architecture\.md/);
  assert.deepEqual(
    (await validateDocumentation({ rootDir, pullRequestBody: "## Documentation impact\n" })).filter((error) => error.includes("pull request body")),
    [
      "pull request body: select exactly one documentation-impact declaration",
      "pull request body: select exactly one security-impact declaration",
      "pull request body: provide documentation-impact details",
      "pull request body: provide security-impact details",
    ],
  );
});
