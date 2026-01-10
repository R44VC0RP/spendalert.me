/**
 * Exa AI Search API Client
 * https://exa.ai/docs/reference/search
 */

const EXA_API_URL = "https://api.exa.ai";

interface ExaSearchResult {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  image?: string;
  favicon?: string;
}

interface ExaSearchResponse {
  requestId: string;
  results: ExaSearchResult[];
  searchType: string;
}

interface ExaAnswerResponse {
  answer: string;
  citations: Array<{
    id: string;
    url: string;
    title: string;
    author?: string;
    publishedDate?: string;
    text?: string;
  }>;
}

interface SearchOptions {
  query: string;
  numResults?: number;
  type?: "auto" | "neural" | "fast" | "deep";
  category?: "news" | "research paper" | "company" | "pdf" | "github" | "tweet";
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeText?: boolean;
  includeSummary?: boolean;
}

interface AnswerOptions {
  query: string;
  includeText?: boolean;
}

function getApiKey(): string {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    throw new Error("EXA_API_KEY environment variable is not set");
  }
  return key;
}

/**
 * Search the web using Exa's neural search
 */
export async function searchWeb(options: SearchOptions): Promise<ExaSearchResponse> {
  const {
    query,
    numResults = 5,
    type = "auto",
    category,
    includeDomains,
    excludeDomains,
    startPublishedDate,
    endPublishedDate,
    includeText = true,
    includeSummary = true,
  } = options;

  const body: Record<string, unknown> = {
    query,
    numResults,
    type,
    text: includeText,
    summary: includeSummary,
  };

  if (category) body.category = category;
  if (includeDomains?.length) body.includeDomains = includeDomains;
  if (excludeDomains?.length) body.excludeDomains = excludeDomains;
  if (startPublishedDate) body.startPublishedDate = startPublishedDate;
  if (endPublishedDate) body.endPublishedDate = endPublishedDate;

  const response = await fetch(`${EXA_API_URL}/search`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Exa search failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Search for recent news articles
 */
export async function searchNews(
  query: string,
  options?: {
    numResults?: number;
    daysBack?: number;
  }
): Promise<ExaSearchResponse> {
  const { numResults = 5, daysBack = 7 } = options || {};

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return searchWeb({
    query,
    numResults,
    category: "news",
    startPublishedDate: startDate.toISOString(),
    endPublishedDate: endDate.toISOString(),
  });
}

/**
 * Get a direct answer to a question using Exa's Answer API
 */
export async function askQuestion(options: AnswerOptions): Promise<ExaAnswerResponse> {
  const { query, includeText = true } = options;

  const response = await fetch(`${EXA_API_URL}/answer`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      text: includeText,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Exa answer failed: ${response.status} ${error}`);
  }

  return response.json();
}

// Export types
export type { ExaSearchResult, ExaSearchResponse, ExaAnswerResponse, SearchOptions, AnswerOptions };
