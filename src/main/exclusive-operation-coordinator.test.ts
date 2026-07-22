import { describe, expect, it } from "vitest";
import { ExclusiveOperationCoordinator } from "./exclusive-operation-coordinator";

describe("ExclusiveOperationCoordinator", () => {
  it("does not overlap a queued runtime launch with formal verification", async () => {
    const coordinator = new ExclusiveOperationCoordinator();
    const events: string[] = [];
    let releaseVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const verification = coordinator.run(async () => {
      events.push("verification-started");
      await verificationGate;
      events.push("verification-finished");
    });
    const launch = coordinator.run(async () => { events.push("runtime-launched"); });
    await Promise.resolve();
    expect(events).toEqual(["verification-started"]);

    releaseVerification();
    await Promise.all([verification, launch]);
    expect(events).toEqual(["verification-started", "verification-finished", "runtime-launched"]);
  });

  it("releases the next operation after a failure", async () => {
    const coordinator = new ExclusiveOperationCoordinator();
    const failed = coordinator.run(async () => { throw new Error("transition failed"); });
    const next = coordinator.run(async () => "restored");

    await expect(failed).rejects.toThrow("transition failed");
    await expect(next).resolves.toBe("restored");
  });

  it("drains accepted work and rejects new transitions while closing", async () => {
    const coordinator = new ExclusiveOperationCoordinator();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = coordinator.run(() => gate);
    let drained = false;
    const closing = coordinator.closeAndDrain().then(() => { drained = true; });
    await Promise.resolve();

    expect(drained).toBe(false);
    await expect(coordinator.run(async () => undefined)).rejects.toThrow("coordinator is closing");
    release();
    await Promise.all([active, closing]);
    expect(drained).toBe(true);
  });
});
