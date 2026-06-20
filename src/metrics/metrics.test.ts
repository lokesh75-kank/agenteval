import { describe, it, expect } from 'vitest';
import {
  recallAtK,
  precisionAtK,
  reciprocalRank,
  mean,
  summarize,
  diffSummaries,
  type PerQueryMetric,
} from './index.js';
import { computeRecordMetric } from './record.js';

describe('recallAtK', () => {
  it('counts relevant items found within the top K', () => {
    // 2 of 3 relevant ids appear in the top 3.
    expect(recallAtK(['a', 'b', 'x'], ['a', 'b', 'c'], 3)).toBeCloseTo(2 / 3);
  });

  it('respects the K cutoff', () => {
    // 'c' is relevant but sits at rank 4, outside top 2.
    expect(recallAtK(['a', 'x', 'y', 'c'], ['a', 'c'], 2)).toBeCloseTo(0.5);
  });

  it('returns 1 when there are no relevant items (vacuously satisfied)', () => {
    expect(recallAtK(['a', 'b'], [], 5)).toBe(1);
    expect(recallAtK([], new Set<string>(), 5)).toBe(1);
  });

  it('accepts a Set for the relevant argument', () => {
    expect(recallAtK(['a', 'b'], new Set(['a']), 5)).toBe(1);
  });

  it('returns 0 when nothing relevant is returned', () => {
    expect(recallAtK(['x', 'y'], ['a', 'b'], 5)).toBe(0);
  });
});

describe('precisionAtK', () => {
  it('is the relevant fraction of the top K', () => {
    expect(precisionAtK(['a', 'x', 'b'], ['a', 'b'], 3)).toBeCloseTo(2 / 3);
  });

  it('returns 1 for k <= 0 (no results requested means no false positives)', () => {
    expect(precisionAtK(['a', 'b'], ['a'], 0)).toBe(1);
    expect(precisionAtK(['a', 'b'], ['a'], -1)).toBe(1);
  });

  it('returns 0 when there are no results to evaluate', () => {
    expect(precisionAtK([], ['a'], 5)).toBe(0);
  });

  it('divides by the actual window size when fewer than K returned', () => {
    // Only 2 results returned for k=5: 1 relevant of 2 -> 0.5.
    expect(precisionAtK(['a', 'x'], ['a'], 5)).toBeCloseTo(0.5);
  });
});

describe('reciprocalRank', () => {
  it('is 1 / rank of the first relevant hit', () => {
    expect(reciprocalRank(['x', 'a', 'b'], ['a'])).toBeCloseTo(1 / 2);
    expect(reciprocalRank(['a'], ['a'])).toBe(1);
  });

  it('is 0 when no relevant item is returned', () => {
    expect(reciprocalRank(['x', 'y'], ['a'])).toBe(0);
    expect(reciprocalRank([], ['a'])).toBe(0);
  });

  it('uses only the first relevant occurrence', () => {
    expect(reciprocalRank(['x', 'a', 'b'], ['a', 'b'])).toBeCloseTo(1 / 2);
  });
});

describe('mean', () => {
  it('averages a list', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns 0 for an empty list', () => {
    expect(mean([])).toBe(0);
  });
});

describe('summarize', () => {
  it('macro-averages per-query rows and reports the count', () => {
    const rows: PerQueryMetric[] = [
      { recallAt5: 1, recallAt10: 1, precisionAt5: 0.5, mrr: 1 },
      { recallAt5: 0, recallAt10: 0.5, precisionAt5: 0.5, mrr: 0 },
    ];
    const s = summarize(rows);
    expect(s.count).toBe(2);
    expect(s.recallAt5).toBeCloseTo(0.5);
    expect(s.recallAt10).toBeCloseTo(0.75);
    expect(s.precisionAt5).toBeCloseTo(0.5);
    expect(s.mrr).toBeCloseTo(0.5);
  });

  it('handles an empty dataset', () => {
    const s = summarize([]);
    expect(s).toEqual({
      count: 0,
      recallAt5: 0,
      recallAt10: 0,
      precisionAt5: 0,
      mrr: 0,
    });
  });
});

describe('diffSummaries', () => {
  it('returns current minus baseline in percentage points', () => {
    const baseline = {
      count: 1,
      recallAt5: 0.5,
      recallAt10: 0.6,
      precisionAt5: 0.4,
      mrr: 0.5,
    };
    const current = {
      count: 1,
      recallAt5: 0.7,
      recallAt10: 0.5,
      precisionAt5: 0.4,
      mrr: 0.8,
    };
    const d = diffSummaries(baseline, current);
    expect(d.recallAt5Pp).toBeCloseTo(0.2);
    expect(d.recallAt10Pp).toBeCloseTo(-0.1); // a regression shows as negative
    expect(d.precisionAt5Pp).toBeCloseTo(0);
    expect(d.mrrPp).toBeCloseTo(0.3);
  });
});

describe('computeRecordMetric', () => {
  it('flags first-pass acceptance when draft equals final (ignoring whitespace)', () => {
    const draft = JSON.stringify({
      sections: { s1: { content: 'The device   meets spec.' } },
    });
    const final = JSON.stringify({
      sections: { s1: { content: 'The device meets spec.' } },
    });
    const m = computeRecordMetric({ agentDraftDocument: draft, finalDocument: final });
    expect(m.firstPassAcceptance).toBe(true);
    expect(m.editDistance).toBe(0);
    expect(m.editDistancePct).toBe(0);
  });

  it('measures edit distance in characters when the human changes words', () => {
    const draft = JSON.stringify({ sections: { s1: { content: 'alpha beta gamma' } } });
    const final = JSON.stringify({ sections: { s1: { content: 'alpha beta delta' } } });
    const m = computeRecordMetric({ agentDraftDocument: draft, finalDocument: final });
    expect(m.firstPassAcceptance).toBe(false);
    // 'gamma' (5) removed + 'delta' (5) added = 10 chars changed.
    expect(m.editDistance).toBe(10);
    expect(m.editDistancePct).toBeGreaterThan(0);
  });

  it('falls back to raw text when the document is not structured JSON', () => {
    const m = computeRecordMetric({
      agentDraftDocument: 'plain draft text',
      finalDocument: 'plain draft text',
    });
    expect(m.firstPassAcceptance).toBe(true);
  });

  it('produces deterministic sha256 hashes of the raw inputs', () => {
    const input = {
      agentDraftDocument: 'a',
      finalDocument: 'b',
    };
    const a = computeRecordMetric(input);
    const b = computeRecordMetric(input);
    expect(a.agentDraftHash).toBe(b.agentDraftHash);
    expect(a.finalDocumentHash).toBe(b.finalDocumentHash);
    expect(a.agentDraftHash).toHaveLength(64); // hex sha256
    expect(a.agentDraftHash).not.toBe(a.finalDocumentHash);
  });

  it('defaults refusalGapCount to 0 and citation validity to 1 when no refs', () => {
    const m = computeRecordMetric({
      agentDraftDocument: 'no citations here',
      finalDocument: 'no citations here',
    });
    expect(m.citationValidityPct).toBe(1);
  });

  it('counts broken markers against citation validity', () => {
    // Two broken placeholders, no live refs -> 0 valid.
    const broken = 'The result is conclusive [GAP?] and verified [E?].';
    const m = computeRecordMetric({
      agentDraftDocument: broken,
      finalDocument: broken,
    });
    expect(m.citationValidityPct).toBe(0);
  });
});
