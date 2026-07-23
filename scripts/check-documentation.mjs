import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_DOCUMENTS = [
  "README.md",
  "CONTRIBUTING.md",
  "CODING_STANDARDS.md",
  "docs/development.md",
  "docs/architecture.md",
  ".github/pull_request_template.md",
];

const REQUIRED_PULL_REQUEST_SECTIONS = ["Documentation impact", "Security impact"];
const REQUIRED_CANONICAL_LINKS = [
  { source: "README.md", target: "docs/development.md" },
  { source: "README.md", target: "docs/architecture.md" },
];
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", "test-results", ".vite", ".agents", ".claude"]);

async function markdownFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      files.push(...(await markdownFiles(rootDir, path.join(currentDir, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(rootDir, path.join(currentDir, entry.name)));
    }
  }

  return files.sort();
}

function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const heading = match[1].replace(/`/g, "").replace(/\[[^\]]*\]\([^)]*\)/g, "");
    const slug = heading
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g)].map(
    (match) => match[1].replace(/^<|>$/g, ""),
  );
}

function isExternalLink(target) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

async function checkLocalLinks(rootDir, markdownPath, markdown, errors) {
  for (const rawTarget of markdownLinks(markdown)) {
    if (isExternalLink(rawTarget)) {
      continue;
    }

    let target;
    try {
      target = decodeURIComponent(rawTarget);
    } catch {
      errors.push(`${markdownPath}: broken local link (invalid URI): ${rawTarget}`);
      continue;
    }

    const [targetPath, fragment] = target.split("#", 2);
    const linkedPath = targetPath.length === 0 ? markdownPath : path.posix.normalize(path.posix.join(path.posix.dirname(markdownPath), targetPath));
    if (linkedPath === ".." || linkedPath.startsWith("../")) {
      errors.push(`${markdownPath}: broken local link: ${rawTarget}`);
      continue;
    }
    const absolutePath = path.join(rootDir, linkedPath);
    let linkedMarkdown;
    try {
      const linkedStat = await stat(absolutePath);
      if (linkedStat.isDirectory()) {
        continue;
      }
      linkedMarkdown = await readFile(absolutePath, "utf8");
    } catch {
      errors.push(`${markdownPath}: broken local link: ${rawTarget}`);
      continue;
    }

    if (fragment && path.extname(linkedPath).toLowerCase() === ".md" && !headingAnchors(linkedMarkdown).has(fragment.toLowerCase())) {
      errors.push(`${markdownPath}: broken local anchor: ${rawTarget}`);
    }
  }
}

async function checkDocumentedScripts(rootDir, markdownPath, markdown, scripts, errors) {
  for (const match of markdown.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    const scriptName = match[1];
    if (!Object.hasOwn(scripts, scriptName)) {
      errors.push(`${markdownPath}: documented npm script does not exist: ${scriptName}`);
    }
  }
}

function declarationSelection(body, optionLabel) {
  const option = new RegExp(`^- \\[([ xX])\\] ${optionLabel}`, "m").exec(body);
  return option?.[1].toLowerCase() === "x";
}

function checkPullRequestDeclarations(body, errors) {
  const documentationAffected = declarationSelection(body, "Documentation is affected");
  const documentationUnaffected = declarationSelection(body, "Documentation is not affected");
  const securityAffected = declarationSelection(body, "Security-sensitive code");
  const securityUnaffected = declarationSelection(body, "Security impact is limited to none");

  if (documentationAffected === documentationUnaffected) {
    errors.push("pull request body: select exactly one documentation-impact declaration");
  }
  if (securityAffected === securityUnaffected) {
    errors.push("pull request body: select exactly one security-impact declaration");
  }
  for (const [label, errorLabel] of [
    ["Documentation impact details", "documentation-impact"],
    ["Security impact details", "security-impact"],
  ]) {
    const detailMatch = new RegExp(`^${label}:\\s*(.*)$`, "m").exec(body);
    const detail = detailMatch?.[1].replace(/<!--.*?-->/g, "").trim() ?? "";
    if (detail.length < 12 || ["x", "n/a", "none", "no", "tbd", "todo"].includes(detail.toLowerCase())) {
      errors.push(`pull request body: provide ${errorLabel} details`);
    }
  }
}

export async function validateDocumentation({ rootDir, pullRequestBody }) {
  const errors = [];
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};

  for (const requiredDocument of REQUIRED_DOCUMENTS) {
    try {
      await readFile(path.join(rootDir, requiredDocument), "utf8");
    } catch {
      errors.push(`missing required document: ${requiredDocument}`);
    }
  }

  const templatePath = ".github/pull_request_template.md";
  try {
    const template = await readFile(path.join(rootDir, templatePath), "utf8");
    for (const section of REQUIRED_PULL_REQUEST_SECTIONS) {
      if (!new RegExp(`^##\\s+${section.replace(" ", "\\s+")}\\s*$`, "m").test(template)) {
        errors.push(`${templatePath}: missing required section: ${section}`);
      }
    }
  } catch {
    // The missing document error above is sufficient.
  }

  for (const { source, target } of REQUIRED_CANONICAL_LINKS) {
    try {
      const sourceMarkdown = await readFile(path.join(rootDir, source), "utf8");
      const links = markdownLinks(sourceMarkdown).map((link) => link.split("#", 1)[0]);
      if (!links.includes(target)) {
        errors.push(`${source}: missing canonical documentation link: ${target}`);
      }
    } catch {
      // The missing document error above is sufficient.
    }
  }

  if (pullRequestBody !== undefined) {
    checkPullRequestDeclarations(pullRequestBody, errors);
  }

  for (const markdownPath of await markdownFiles(rootDir)) {
    const markdown = await readFile(path.join(rootDir, markdownPath), "utf8");
    await checkLocalLinks(rootDir, markdownPath, markdown, errors);
    await checkDocumentedScripts(rootDir, markdownPath, markdown, scripts, errors);
  }

  return errors;
}

async function main() {
  const pullRequestBody = process.env.GITHUB_EVENT_NAME === "pull_request" ? process.env.PULL_REQUEST_BODY ?? "" : undefined;
  const errors = await validateDocumentation({ rootDir: process.cwd(), pullRequestBody });
  if (errors.length > 0) {
    console.error(errors.map((error) => `Documentation policy: ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Documentation policy passed: required documents, local links, anchors, npm scripts, and PR declarations are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
