import type { ExternalResearch, ExternalResearchRequest, ExternalResearchResult } from "../shared/external-research";

export class BrowserExternalResearch implements ExternalResearch {
  constructor(private readonly openExternal: (url: string) => Promise<void>) {}

  async research(request: ExternalResearchRequest): Promise<ExternalResearchResult> {
    const destination = new URL(request.destination);
    if (destination.protocol !== "https:" || destination.hostname !== "duckduckgo.com") {
      throw new Error("The external research destination is not allowed.");
    }
    if (request.signal.aborted) throw new DOMException("External research was stopped.", "AbortError");
    await Promise.race([
      this.openExternal(destination.href),
      new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(
          new DOMException("External research was stopped.", "AbortError")
        ), { once: true });
      })
    ]);
    return {
      title: "Research opened in browser",
      summary: request.excerpts.length > 0
        ? `Opened the inspectable destination with ${request.excerpts.length} authorized Source Excerpt${request.excerpts.length === 1 ? "" : "s"}.`
        : "Opened the inspectable destination using only the Derived Research Query.",
      sources: [{ title: "Inspect external research destination", url: destination.href }]
    };
  }
}
