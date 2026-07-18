import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executablePath = join(
  process.cwd(),
  "out",
  `Quick Study-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`,
  "Quick Study.app",
  "Contents",
  "MacOS",
  "Quick Study"
);

test("packaged Quick Study starts, persists, quits, relaunches, and resumes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-smoke-"));
  let launched: { browser: Browser; page: Page; process: ChildProcess } | undefined;

  const launch = async () => {
    const port = await availablePort();
    const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", QUICK_STUDY_DATA_DIR: dataDirectory },
      stdio: "pipe"
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    await waitForDebugger(port, child, () => output);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error("Packaged Quick Study did not open a renderer page.");
    launched = { browser, page, process: child };
    return page;
  };

  const quit = async () => {
    if (!launched) return;
    const current = launched;
    launched = undefined;
    await current.page.close();
    const exitedNormally = await waitForExit(current.process, 5_000);
    await current.browser.close().catch(() => undefined);
    if (!exitedNormally) {
      current.process.kill("SIGTERM");
      throw new Error("Packaged Quick Study did not exit after its last window closed.");
    }
  };

  try {
    let page = await launch();
    await expect(page.getByRole("heading", { name: "Begin with the mathematics" })).toBeVisible();

    await page.getByLabel("Typed mathematics").fill("Show that every convergent sequence is bounded.");
    await page.getByRole("button", { name: "Start Quick Study" }).click();
    await page.getByLabel("Learning Goal").fill("Understand where convergence controls the tail");
    await page.getByLabel("Session Target").fill("Bound the sequence using its finite prefix and tail");
    await page.getByRole("button", { name: "Leave session" }).click();

    await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
    await expect(page.getByText("Understand where convergence controls the tail")).toBeVisible();
    await quit();

    page = await launch();
    await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
    await expect(page.getByText("Bound the sequence using its finite prefix and tail")).toBeVisible();
    await page.getByRole("button", { name: "Resume Quick Study" }).click();

    await expect(page.getByRole("heading", { name: "Mathematical Workbench" })).toBeVisible();
    await expect(page.getByLabel("Learning Goal")).toHaveValue("Understand where convergence controls the tail");
  } finally {
    await quit();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a debugging port."));
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForDebugger(port: number, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Quick Study exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The packaged main process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for packaged Quick Study to expose its renderer.\n${output()}`);
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
