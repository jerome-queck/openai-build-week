export interface DerivedResearchQueryInput {
  theoremNames: string[];
  assumptions: string[];
  keywords: string[];
}

export interface DerivedResearchQuery extends DerivedResearchQueryInput {
  text: string;
}

export interface ResearchExcerpt {
  sourceId: string;
  kind: "excerpt" | "equation" | "selectedPages";
  content: string;
  location: string;
  relevance: "learnerSelectedForQuery";
}

export interface ExternalResearchRequest {
  query: DerivedResearchQuery;
  queryOrigin: "learnerAuthored" | "automaticCorroboration";
  informedBySourceIds: string[];
  destination: string;
  excerpts: ResearchExcerpt[];
  signal: AbortSignal;
}

export interface ExternalResearchResult {
  title: string;
  summary: string;
  sources: Array<{ title: string; url: string }>;
}

export interface ExternalResearch {
  research(request: ExternalResearchRequest): Promise<ExternalResearchResult>;
}

export function validatedExternalResearchResult(value: unknown): ExternalResearchResult {
  const malformed = new Error("The external research service returned a malformed result. No broader egress was attempted.");
  if (!value || typeof value !== "object") throw malformed;
  const result = value as Partial<ExternalResearchResult>;
  if (typeof result.title !== "string" || !result.title.trim()
    || typeof result.summary !== "string" || !result.summary.trim()
    || !Array.isArray(result.sources)) throw malformed;
  const sources = result.sources.map((source) => {
    if (!source || typeof source !== "object" || typeof source.title !== "string" || !source.title.trim()
      || typeof source.url !== "string") throw malformed;
    let url: URL;
    try { url = new URL(source.url); } catch { throw malformed; }
    if (url.protocol !== "https:") throw malformed;
    return { title: source.title.trim(), url: url.href };
  });
  return { title: result.title.trim(), summary: result.summary.trim(), sources };
}

export function buildDerivedResearchQuery(input: DerivedResearchQueryInput): DerivedResearchQuery {
  const theoremNames = normalizedTerms(input.theoremNames, "theorem name");
  const assumptions = normalizedTerms(input.assumptions, "assumption");
  const keywords = normalizedTerms(input.keywords, "mathematical keyword");
  const terms = [...theoremNames, ...assumptions, ...keywords];
  if (terms.length === 0) throw new Error("Add a theorem name, assumption, or mathematical keyword for web research.");
  return { text: terms.join("; "), theoremNames, assumptions, keywords };
}

function normalizedTerms(values: string[], label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`Derived Research Query ${label}s are invalid.`);
  if (values.length > 8) throw new Error(`A Derived Research Query may contain at most 8 ${label}s.`);
  const terms = values.map((value) => {
    if (typeof value !== "string") throw new Error(`Derived Research Query ${label}s are invalid.`);
    const term = value.trim().replace(/\s+/g, " ");
    if (!term || term.length > 160) throw new Error(`Each Derived Research Query ${label} must contain 1–160 characters.`);
    return term;
  });
  return terms.filter((term, index) => terms.findIndex((candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase()) === index);
}
