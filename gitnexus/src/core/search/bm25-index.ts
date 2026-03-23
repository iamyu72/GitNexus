/**
 * Full-Text Search via LadybugDB FTS
 *
 * Uses LadybugDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 */

import { queryFTS } from '../lbug/lbug-adapter.js';

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
}

/**
 * Execute a single FTS query via a custom executor (for MCP connection pool).
 * Returns the same shape as core queryFTS (from LadybugDB adapter).
 */
async function queryFTSViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  tableName: string,
  indexName: string,
  query: string,
  limit: number,
): Promise<Array<{ filePath: string; score: number }>> {
  // Escape single quotes and backslashes to prevent Cypher injection
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const cypher = `
    CALL QUERY_FTS_INDEX('${tableName}', '${indexName}', '${escapedQuery}', conjunctive := false)
    RETURN node, score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  try {
    const rows = await executor(cypher);
    return rows.map((row: any) => {
      const node = row.node || row[0] || {};
      const score = row.score ?? row[1] ?? 0;
      return {
        filePath: node.filePath || '',
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Search using LadybugDB's built-in FTS (always fresh, reads from disk)
 *
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 *
 * @param query - Search query string
 * @param limit - Maximum results
 * @param repoId - If provided, queries will be routed via the MCP connection pool
 * @returns Ranked search results from FTS indexes
 */
// Expand query by splitting camelCase/PascalCase and snake_case tokens
const expandQuery = (query: string): string => {
  const words = query.split(/\s+/);
  const expanded = new Set<string>();
  for (const w of words) {
    expanded.add(w);
    // Split camelCase: "RetryableHttpExecutor" → ["Retryable", "Http", "Executor"]
    const camelParts = w.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/\s+/);
    for (const p of camelParts) expanded.add(p.toLowerCase());
    // Split snake_case
    for (const p of w.split('_')) if (p) expanded.add(p.toLowerCase());
  }
  return Array.from(expanded).join(' ');
};

export const searchFTSFromLbug = async (query: string, limit: number = 20, repoId?: string): Promise<BM25SearchResult[]> => {
  query = expandQuery(query);
  let fileResults: any[], functionResults: any[], classResults: any[], methodResults: any[], interfaceResults: any[];

  if (repoId) {
    // Use MCP connection pool via dynamic import
    // IMPORTANT: FTS queries run sequentially to avoid connection contention.
    // The MCP pool supports multiple connections, but FTS is best run serially.
    const { executeQuery } = await import('../../mcp/core/lbug-adapter.js');
    const executor = (cypher: string) => executeQuery(repoId, cypher);
    fileResults = await queryFTSViaExecutor(executor, 'File', 'file_fts', query, limit);
    functionResults = await queryFTSViaExecutor(executor, 'Function', 'function_fts', query, limit);
    classResults = await queryFTSViaExecutor(executor, 'Class', 'class_fts', query, limit);
    methodResults = await queryFTSViaExecutor(executor, 'Method', 'method_fts', query, limit);
    interfaceResults = await queryFTSViaExecutor(executor, 'Interface', 'interface_fts', query, limit);
  } else {
    // Use core lbug adapter (CLI / pipeline context) — also sequential for safety
    fileResults = await queryFTS('File', 'file_fts', query, limit, false).catch(() => []);
    functionResults = await queryFTS('Function', 'function_fts', query, limit, false).catch(() => []);
    classResults = await queryFTS('Class', 'class_fts', query, limit, false).catch(() => []);
    methodResults = await queryFTS('Method', 'method_fts', query, limit, false).catch(() => []);
    interfaceResults = await queryFTS('Interface', 'interface_fts', query, limit, false).catch(() => []);
  }
  
  // Merge results by filePath, summing scores for same file
  const merged = new Map<string, { filePath: string; score: number }>();
  
  const addResults = (results: any[]) => {
    for (const r of results) {
      const existing = merged.get(r.filePath);
      if (existing) {
        existing.score += r.score;
      } else {
        merged.set(r.filePath, { filePath: r.filePath, score: r.score });
      }
    }
  };
  
  addResults(fileResults);
  addResults(functionResults);
  addResults(classResults);
  addResults(methodResults);
  addResults(interfaceResults);
  
  // Sort by score descending and add rank
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return sorted.map((r, index) => ({
    filePath: r.filePath,
    score: r.score,
    rank: index + 1,
  }));
};
