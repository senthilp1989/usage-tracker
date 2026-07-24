function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  return dist[rows - 1][cols - 1];
}

function typoThreshold(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

/** True if `query` appears in `target` verbatim, or is a close typo of one of its tokens. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  const threshold = typoThreshold(q.length);
  return t
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => levenshtein(q, token) <= threshold);
}
