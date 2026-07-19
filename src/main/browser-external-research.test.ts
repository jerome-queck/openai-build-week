import { describe, expect, it, vi } from "vitest";
import { BrowserExternalResearch } from "./browser-external-research";
import { buildDerivedResearchQuery } from "../shared/external-research";

describe("Browser External Research", () => {
  it("opens only the disclosed DuckDuckGo HTTPS destination", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const research = new BrowserExternalResearch(openExternal);
    const destination = "https://duckduckgo.com/?q=orbit-stabilizer";
    const result = await research.research({
      query: buildDerivedResearchQuery({ theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] }),
      queryOrigin: "learnerAuthored",
      informedBySourceIds: [],
      destination,
      excerpts: [],
      signal: new AbortController().signal
    });
    expect(openExternal).toHaveBeenCalledWith(destination);
    expect(result).toMatchObject({
      title: "Research opened in browser",
      sources: [{ url: destination }]
    });
  });

  it("rejects undisclosed or non-HTTPS destinations", async () => {
    const research = new BrowserExternalResearch(vi.fn());
    const query = buildDerivedResearchQuery({ theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: [] });
    for (const destination of ["https://example.com/search", "http://duckduckgo.com/?q=cauchy"]) {
      await expect(research.research({
        query, queryOrigin: "learnerAuthored", informedBySourceIds: [], destination, excerpts: [],
        signal: new AbortController().signal
      }))
        .rejects.toThrow("destination is not allowed");
    }
  });

  it("observes cancellation while the browser handoff is pending", async () => {
    const controller = new AbortController();
    const research = new BrowserExternalResearch(() => new Promise<void>(() => undefined));
    const pending = research.research({
      query: buildDerivedResearchQuery({ theoremNames: ["Sylow theorems"], assumptions: [], keywords: [] }),
      queryOrigin: "learnerAuthored",
      informedBySourceIds: [],
      destination: "https://duckduckgo.com/?q=sylow",
      excerpts: [], signal: controller.signal
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
