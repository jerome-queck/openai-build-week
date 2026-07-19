import { describe, expect, it } from "vitest";
import { coordinateAgentTasks } from "./agent-task-coordinator";

describe("Agent Task coordination", () => {
  it("runs dependent specialist work only after its Agent Brief dependency completes", async () => {
    const events: string[] = [];
    await coordinateAgentTasks([
      { id: "assumptions", dependsOnTaskIds: [], run: async () => { events.push("assumptions:complete"); } },
      { id: "counterexample", dependsOnTaskIds: ["assumptions"], run: async () => { events.push("counterexample:start"); } }
    ], 2);
    expect(events).toEqual(["assumptions:complete", "counterexample:start"]);
  });

  it("runs genuinely independent specialist work concurrently but never beyond its limit", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    };
    const coordinated = coordinateAgentTasks([
      { id: "route-a", dependsOnTaskIds: [], run },
      { id: "route-b", dependsOnTaskIds: [], run },
      { id: "route-c", dependsOnTaskIds: [], run }
    ], 2);
    await viWaitFor(() => expect(active).toBe(2));
    releases.splice(0).forEach((release) => release());
    await viWaitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await coordinated;
    expect(maxActive).toBe(2);
  });
});

async function viWaitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { assertion(); return; } catch { await Promise.resolve(); }
  }
  assertion();
}
