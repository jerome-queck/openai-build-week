import { describe, expect, it } from "vitest";
import { runBoundedPackagedAction } from "../../tests/packaged-action";

describe("runBoundedPackagedAction", () => {
  it("fails a stalled learner action at its local operation boundary", async () => {
    const startedAt = Date.now();
    await expect(runBoundedPackagedAction(
      "Open Linked Source lecture-3.pdf",
      () => new Promise<never>(() => undefined),
      25
    )).rejects.toThrow(/Open Linked Source lecture-3\.pdf.*25ms/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
