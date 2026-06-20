// Retrieval quality metrics.
//
// These functions are pure: given a ranked list of returned ids and the set
// of ids the dataset says are relevant, they compute standard IR metrics. The
// caller supplies the lists; storage and DB access are not this module's
// concern. Extracted verbatim from the original retrieval eval harness because
// they are already standalone and well-tested.

/**
 * Recall@K: fraction of relevant items that appeared in the top K results.
 * Returns 1.0 when `relevant` is empty (a query with no expected hits is
 * trivially satisfied).
 */
export function recallAtK(
  returned: readonly string[],
  relevant: ReadonlySet<string> | readonly string[],
  k: number,
): number {
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  if (rel.size === 0) return 1;
  const top = returned.slice(0, k);
  let hit = 0;
  for (const id of top) if (rel.has(id)) hit++;
  return hit / rel.size;
}

/**
 * Precision@K: fraction of top-K results that are relevant.
 * Returns 1.0 when K <= 0 (no results requested, so no false positives).
 */
export function precisionAtK(
  returned: readonly string[],
  relevant: ReadonlySet<string> | readonly string[],
  k: number,
): number {
  if (k <= 0) return 1;
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  const top = returned.slice(0, k);
  if (top.length === 0) return 0;
  let hit = 0;
  for (const id of top) if (rel.has(id)) hit++;
  return hit / top.length;
}

/**
 * Mean Reciprocal Rank: 1 / (rank of first relevant result), or 0 if none in
 * the returned list. Useful for "did we surface the right answer near the
 * top" questions.
 */
export function reciprocalRank(
  returned: readonly string[],
  relevant: ReadonlySet<string> | readonly string[],
): number {
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  for (let i = 0; i < returned.length; i++) {
    // noUncheckedIndexedAccess: returned[i] is string | undefined, but the loop
    // bound guarantees it is defined; the Set lookup tolerates undefined anyway.
    const id = returned[i];
    if (id !== undefined && rel.has(id)) return 1 / (i + 1);
  }
  return 0;
}

/** Mean of a numeric list. Returns 0 for an empty list. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Per-query metric row consumed by {@link summarize}. */
export interface PerQueryMetric {
  recallAt5: number;
  recallAt10: number;
  precisionAt5: number;
  mrr: number;
}

/** Aggregate summary produced by {@link summarize}. */
export interface MetricSummary {
  count: number;
  recallAt5: number;
  recallAt10: number;
  precisionAt5: number;
  mrr: number;
}

/**
 * Aggregate per-query metrics into a dataset summary.
 *
 * Returns the macro-average (mean of per-query scores). Each query weighs
 * equally regardless of how many relevant items it has, which is the right
 * default for a curated golden set with few items per query.
 */
export function summarize(perQuery: readonly PerQueryMetric[]): MetricSummary {
  return {
    count: perQuery.length,
    recallAt5: mean(perQuery.map((q) => q.recallAt5)),
    recallAt10: mean(perQuery.map((q) => q.recallAt10)),
    precisionAt5: mean(perQuery.map((q) => q.precisionAt5)),
    mrr: mean(perQuery.map((q) => q.mrr)),
  };
}

/** Deltas between two {@link MetricSummary} snapshots, in percentage points. */
export interface SummaryDiff {
  recallAt5Pp: number;
  recallAt10Pp: number;
  precisionAt5Pp: number;
  mrrPp: number;
}

/**
 * Compare two summary snapshots (e.g. baseline vs. current). Returns the
 * deltas in percentage points (so 0.05 means "5pp better"). Used by a CI gate
 * to fail PRs that regress retrieval quality beyond a threshold.
 */
export function diffSummaries(
  baseline: MetricSummary,
  current: MetricSummary,
): SummaryDiff {
  return {
    recallAt5Pp: current.recallAt5 - baseline.recallAt5,
    recallAt10Pp: current.recallAt10 - baseline.recallAt10,
    precisionAt5Pp: current.precisionAt5 - baseline.precisionAt5,
    mrrPp: current.mrr - baseline.mrr,
  };
}
