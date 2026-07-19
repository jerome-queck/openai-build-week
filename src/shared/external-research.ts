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
  researchDepth: "lightweight" | "deep";
  informedBySourceIds: string[];
  destination: string;
  excerpts: ResearchExcerpt[];
  signal: AbortSignal;
}

export interface ExternalResearchResult {
  title: string;
  summary: string;
  sources: Array<{ title: string; url: string }>;
  corroboration?: CorroborationResearchResult;
}

export interface CorroborationResearchResult {
  relevantResult: string;
  errataCheck: "noneFound" | "found" | "unavailable";
  proposedApproachDeparture: boolean;
  evidence: CorroborationResearchEvidence[];
}

export interface CorroborationResearchEvidence {
  sourceTitle: string;
  sourceUrl: string;
  authority: "primary" | "authoritative" | "derivative" | "unknown";
  relevance: "direct" | "related" | "weak";
  relation: "supports" | "conflicts" | "erratum" | "unassessed";
  assumptions: "matches" | "mismatch" | "notAssessed";
  conclusion: "matches" | "mismatch" | "notAssessed";
  proofApproaches: string[];
  detail: string;
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
  return {
    title: result.title.trim(),
    summary: result.summary.trim(),
    sources,
    ...(result.corroboration === undefined ? {} : { corroboration: validatedCorroborationResearchResult(result.corroboration) })
  };
}

export function validatedCorroborationResearchResult(value: unknown): CorroborationResearchResult {
  const malformed = new Error("The external research service returned malformed corroboration evidence. No claim was treated as settled.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed;
  const result = value as Partial<CorroborationResearchResult>;
  if (typeof result.relevantResult !== "string" || !result.relevantResult.trim()
    || !["noneFound", "found", "unavailable"].includes(String(result.errataCheck))
    || typeof result.proposedApproachDeparture !== "boolean" || !Array.isArray(result.evidence)) throw malformed;
  const evidence = result.evidence.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw malformed;
    const candidate = item as Partial<CorroborationResearchEvidence>;
    if (typeof candidate.sourceTitle !== "string" || !candidate.sourceTitle.trim()
      || typeof candidate.sourceUrl !== "string" || typeof candidate.detail !== "string" || !candidate.detail.trim()
      || !["primary", "authoritative", "derivative", "unknown"].includes(String(candidate.authority))
      || !["direct", "related", "weak"].includes(String(candidate.relevance))
      || !["supports", "conflicts", "erratum", "unassessed"].includes(String(candidate.relation))
      || !["matches", "mismatch", "notAssessed"].includes(String(candidate.assumptions))
      || !["matches", "mismatch", "notAssessed"].includes(String(candidate.conclusion))
      || !Array.isArray(candidate.proofApproaches)
      || candidate.proofApproaches.some((approach) => typeof approach !== "string" || !approach.trim())) throw malformed;
    let sourceUrl: URL;
    try { sourceUrl = new URL(candidate.sourceUrl); } catch { throw malformed; }
    if (sourceUrl.protocol !== "https:") throw malformed;
    return {
      sourceTitle: candidate.sourceTitle.trim(),
      sourceUrl: sourceUrl.href,
      authority: candidate.authority!,
      relevance: candidate.relevance!,
      relation: candidate.relation!,
      assumptions: candidate.assumptions!,
      conclusion: candidate.conclusion!,
      proofApproaches: candidate.proofApproaches.map((approach) => approach.trim()),
      detail: candidate.detail.trim()
    } as CorroborationResearchEvidence;
  });
  return {
    relevantResult: result.relevantResult.trim(),
    errataCheck: result.errataCheck!,
    proposedApproachDeparture: result.proposedApproachDeparture,
    evidence
  };
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
