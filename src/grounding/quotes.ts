// Quote-vs-source verification.
//
// A citation can resolve to a real source and still misquote it. This module
// checks whether a quoted body actually appears in its source text - either
// verbatim or as a near-verbatim contiguous run - using a longest-common-
// substring similarity. Pure functions, with no DB or markup-rewriting coupling.

const HTML_TAG_RE = /<[^>]+>/g;
// Drop every char that is not a unicode letter, number, or whitespace, then
// collapse whitespace runs. Lowercased so case never breaks a substring match.
const NON_TEXT_RE = /[^\p{L}\p{N}\s]/gu;
const WS_RE = /\s+/g;

/**
 * Normalize text for quote comparison: strip HTML, drop punctuation/symbols,
 * collapse whitespace, lowercase. Makes verbatim comparison robust to trivial
 * formatting differences without enabling false matches.
 */
export function normalizeForCompare(s: string): string {
  return s
    .replace(HTML_TAG_RE, ' ')
    .replace(NON_TEXT_RE, ' ')
    .replace(WS_RE, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Length of the longest contiguous common substring of `a` and `b`.
 * O(n*m) time, O(min(n,m)) extra space. Returns 0 for empty inputs.
 */
export function longestCommonSubstringLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  // Iterate so the inner loop runs over the shorter string.
  const [outer, inner] = m <= n ? [a, b] : [b, a];
  const ol = outer.length;
  const il = inner.length;
  let prev = new Array<number>(il + 1).fill(0);
  let curr = new Array<number>(il + 1).fill(0);
  let max = 0;
  for (let i = 1; i <= ol; i++) {
    for (let j = 1; j <= il; j++) {
      // noUncheckedIndexedAccess: outer/inner chars are string|undefined, but
      // i-1 / j-1 are always in-range here. Compare directly.
      if (outer[i - 1] === inner[j - 1]) {
        const diag = prev[j - 1] ?? 0;
        const val = diag + 1;
        curr[j] = val;
        if (val > max) max = val;
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return max;
}

/**
 * Decide whether `quote` is faithfully present in `sourceText`.
 *
 * Returns a `match` boolean and a `similarity` score in [0,1]:
 *   - similarity is `longestCommonSubstring(quote, source) / quote.length` on
 *     normalized text.
 *   - `match` is true when the normalized quote is a verbatim substring of the
 *     source (similarity === 1) or similarity >= 0.9 (near-verbatim run).
 *
 * An empty quote is treated as a non-match (nothing to verify) with similarity 0.
 */
export function quoteMatchesSource(
  quote: string,
  sourceText: string,
): { match: boolean; similarity: number } {
  const normQuote = normalizeForCompare(quote);
  if (normQuote.length === 0) return { match: false, similarity: 0 };

  const normSource = normalizeForCompare(sourceText);
  if (normSource.includes(normQuote)) {
    return { match: true, similarity: 1 };
  }

  const lcs = longestCommonSubstringLength(normQuote, normSource);
  // Decide `match` against the SAME rounded value we report, so the two never
  // disagree at the boundary (e.g. raw 0.904 must not report 0.90 + match=true
  // while raw 0.896 reports 0.90 + match=false).
  const similarity = round2(lcs / normQuote.length);
  return { match: similarity >= 0.9, similarity };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
