import { describe, it, expect } from 'vitest';
import type { AgentTrace } from '../core/trace.js';
import {
  GENERIC_PRESET,
  REGULATED_PRESET,
  detectUncitedClaims,
  parseCitations,
  resolveCitations,
  normalizeForCompare,
  longestCommonSubstringLength,
  quoteMatchesSource,
  findOrphanReferences,
  checkGrounding,
} from './index.js';

// ─────────────────────────────────────────────
// claims
// ─────────────────────────────────────────────

describe('detectUncitedClaims', () => {
  it('flags a regulated claim with imperative language and no citation', () => {
    const text = 'Per 21 CFR 820.100, manufacturers shall establish CAPA procedures.';
    const claims = detectUncitedClaims(text, REGULATED_PRESET);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.pattern).toBe('21 CFR 820.100');
    expect(claims[0]?.offset).toBe(text.indexOf('21 CFR'));
  });

  it('does not flag a regulation mention without imperative language', () => {
    const text = 'This document relates to 21 CFR 820.100 generally.';
    expect(detectUncitedClaims(text, REGULATED_PRESET)).toHaveLength(0);
  });

  it('does not flag a claim already wrapped in a citation span', () => {
    const text =
      'The rule is <span class="citation" data-clause-id="c1">21 CFR 820.100 manufacturers shall act</span>.';
    expect(detectUncitedClaims(text, REGULATED_PRESET)).toHaveLength(0);
  });

  it('does not split sentences inside section numbers', () => {
    const text = 'Under ISO 13485 the supplier must comply. A second sentence.';
    const claims = detectUncitedClaims(text, REGULATED_PRESET);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.sentence).toContain('ISO 13485');
    expect(claims[0]?.sentence).not.toContain('second sentence');
  });

  it('flags a generic statistical claim phrased as a guarantee', () => {
    const text = 'Our product guarantees 80% faster results.';
    const claims = detectUncitedClaims(text, GENERIC_PRESET);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.pattern.toLowerCase()).toContain('80%');
  });

  it('returns empty for empty marker config', () => {
    const text = 'Per 21 CFR 820.100 manufacturers shall act.';
    const claims = detectUncitedClaims(text, {
      claimPatterns: REGULATED_PRESET.claimPatterns,
      imperativeMarkers: [],
    });
    expect(claims).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// citations
// ─────────────────────────────────────────────

describe('parseCitations', () => {
  it('parses bracket tags, clause spans, and inline regs, deduped', () => {
    const text =
      'See [E1] and [GAP-3]. <span class="citation" data-clause-id="cl-7">x</span> Also 21 CFR 820.100. Again [E1].';
    const { refs } = parseCitations(text);
    expect(refs).toEqual(['E1', 'GAP-3', 'cl-7', '21 CFR 820.100']);
  });

  it('ignores reasoning markers like [INFERENCE: ...]', () => {
    const { refs } = parseCitations('A guess [INFERENCE: maybe] and [E2].');
    expect(refs).toEqual(['E2']);
  });
});

describe('resolveCitations', () => {
  it('splits refs into resolved and unresolved by set membership', () => {
    const { resolved, unresolved } = resolveCitations(
      ['E1', 'E2', 'E1', 'cl-9'],
      new Set(['E1', 'cl-9']),
    );
    expect(resolved).toEqual(['E1', 'cl-9']);
    expect(unresolved).toEqual(['E2']);
  });

  it('accepts a plain iterable as knownIds', () => {
    const { resolved, unresolved } = resolveCitations(['a', 'b'], ['a']);
    expect(resolved).toEqual(['a']);
    expect(unresolved).toEqual(['b']);
  });
});

// ─────────────────────────────────────────────
// quotes
// ─────────────────────────────────────────────

describe('quote helpers', () => {
  it('normalizeForCompare strips punctuation, html, case, and whitespace', () => {
    expect(normalizeForCompare('  <b>Hello,</b>   WORLD!  ')).toBe('hello world');
  });

  it('longestCommonSubstringLength finds the longest contiguous run', () => {
    expect(longestCommonSubstringLength('abcdef', 'zzcdezz')).toBe(3); // "cde"
    expect(longestCommonSubstringLength('', 'abc')).toBe(0);
  });

  it('quoteMatchesSource matches verbatim quotes', () => {
    const r = quoteMatchesSource(
      'manufacturers shall establish',
      'Per the rule, manufacturers shall establish procedures.',
    );
    expect(r.match).toBe(true);
    expect(r.similarity).toBe(1);
  });

  it('quoteMatchesSource flags a fabricated quote with low similarity', () => {
    const r = quoteMatchesSource(
      'devices must be painted blue and shipped overnight',
      'The clause concerns calibration records and retention periods.',
    );
    expect(r.match).toBe(false);
    expect(r.similarity).toBeLessThan(0.9);
  });

  it('treats an empty quote as a non-match', () => {
    expect(quoteMatchesSource('', 'anything')).toEqual({ match: false, similarity: 0 });
  });
});

// ─────────────────────────────────────────────
// coherence
// ─────────────────────────────────────────────

describe('findOrphanReferences', () => {
  it('flags a tag referenced across multiple sections', () => {
    const orphans = findOrphanReferences([
      { id: 'qa', title: 'Q&A', content: 'See PA-2 for detail.' },
      { id: 'effectiveness', title: 'Effectiveness', content: 'PA-2 was effective.' },
      { id: 'preventive', title: 'Preventive', content: 'No actions listed.' },
    ]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.tag).toBe('PA-2');
    expect(orphans[0]?.referencingSectionIds).toEqual(['effectiveness', 'qa']);
  });

  it('does not flag a tag confined to a single section', () => {
    const orphans = findOrphanReferences([
      { id: 'corrective', title: 'Corrective', content: 'CA-1 defined and used here.' },
      { id: 'other', title: 'Other', content: 'Nothing relevant.' },
    ]);
    expect(orphans).toHaveLength(0);
  });

  it('ignores tags that only appear inside HTML attributes', () => {
    const orphans = findOrphanReferences([
      { id: 'a', title: 'A', content: '<span data-evidence-id="E1">text</span>' },
      { id: 'b', title: 'B', content: '<span data-evidence-id="E1">more</span>' },
    ]);
    expect(orphans).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// checkGrounding
// ─────────────────────────────────────────────

function trace(partial: Partial<AgentTrace>): AgentTrace {
  return {
    input: { user_message: 'q' },
    finalText: '',
    toolCalls: [],
    ...partial,
  };
}

describe('checkGrounding', () => {
  it('detects uncited claims using the supplied config', () => {
    const result = checkGrounding(
      trace({ finalText: 'Per 21 CFR 820.100 manufacturers shall act.' }),
      { config: REGULATED_PRESET },
    );
    expect(result.uncitedClaims).toHaveLength(1);
    expect(result.unresolvedCitations).toEqual([]); // no knownSources -> skipped
  });

  it('reports unresolved citations only when knownSources is provided', () => {
    const t = trace({ finalText: 'See [E1] and [E9].' });
    expect(checkGrounding(t).unresolvedCitations).toEqual([]);
    expect(
      checkGrounding(t, { knownSources: ['E1'] }).unresolvedCitations,
    ).toEqual(['E9']);
  });

  it('reports quote mismatches from trace citations', () => {
    const result = checkGrounding(
      trace({
        finalText: 'A claim.',
        citations: [
          {
            ref: 'cl-1',
            source: 'The clause concerns calibration records and retention.',
            quote: 'devices must be painted blue',
          },
          {
            ref: 'cl-2',
            source: 'manufacturers shall establish procedures',
            quote: 'manufacturers shall establish',
          },
        ],
      }),
    );
    expect(result.quoteMismatches).toHaveLength(1);
    expect(result.quoteMismatches[0]?.ref).toBe('cl-1');
  });

  it('returns clean result for fully grounded output', () => {
    const result = checkGrounding(
      trace({
        finalText: 'The weather is pleasant today.',
        citations: [{ ref: 'cl-1', source: 'all good here', quote: 'all good' }],
      }),
      { config: REGULATED_PRESET, knownSources: [] },
    );
    expect(result.uncitedClaims).toEqual([]);
    expect(result.unresolvedCitations).toEqual([]);
    expect(result.quoteMismatches).toEqual([]);
  });
});
