import { describe, expect, it } from "vitest";
import { buildDerivedResearchQuery, validatedExternalResearchResult } from "./external-research";

describe("External Research contract", () => {
  it("builds a privacy-minimized Derived Research Query from mathematical terms", () => {
    expect(buildDerivedResearchQuery({
      theoremNames: ["Orbit-stabilizer theorem", "orbit-stabilizer theorem"],
      assumptions: ["G acts on X", "x belongs to X"],
      keywords: ["stabilizer cosets", "group action"]
    })).toEqual({
      text: "Orbit-stabilizer theorem; G acts on X; x belongs to X; stabilizer cosets; group action",
      theoremNames: ["Orbit-stabilizer theorem"],
      assumptions: ["G acts on X", "x belongs to X"],
      keywords: ["stabilizer cosets", "group action"]
    });
  });

  it("rejects malformed research results and non-HTTPS source destinations", () => {
    expect(() => validatedExternalResearchResult({ title: "", summary: "No title", sources: [] }))
      .toThrow("external research service returned a malformed result");
    expect(() => validatedExternalResearchResult({
      title: "Orbit-stabilizer references",
      summary: "Two suitable references were found.",
      sources: [{ title: "Unsafe redirect", url: "file:///Users/learner/notes.pdf" }]
    })).toThrow("external research service returned a malformed result");
    expect(() => validatedExternalResearchResult({
      title: "References", summary: "Evidence returned.",
      sources: [{ title: "Reference", url: "https://example.test/reference" }],
      corroboration: {
        relevantResult: "A theorem", errataCheck: "noneFound", proposedApproachDeparture: false,
        evidence: [{
          sourceTitle: "Local file", sourceUrl: "file:///Users/learner/private.pdf",
          authority: "authoritative", relevance: "direct", relation: "supports",
          assumptions: "matches", conclusion: "matches", proofApproaches: [], detail: "Matches."
        }]
      }
    })).toThrow("malformed corroboration evidence");
  });

  it("has no contract fields for private local context", () => {
    const query = buildDerivedResearchQuery({
      theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: ["finite groups"],
      rawExcerpt: "private passage", localPath: "/Users/learner/private",
      filename: "course-notes.pdf", annotations: ["private note"],
      personalNotes: ["secret"], unrelatedWorkspaceContext: "Topology"
    } as unknown as Parameters<typeof buildDerivedResearchQuery>[0]);
    expect(JSON.stringify(query)).toBe(JSON.stringify({
      text: "Cauchy's theorem; finite groups",
      theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: ["finite groups"]
    }));
  });
});
