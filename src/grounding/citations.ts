// Citation parsing and resolution.
//
// Two pure pieces, both DB-free (Deminn's original validator resolved against
// Prisma; here resolution is pure set-membership against an injected id set):
//
//   parseCitations(text)         -> every inline reference token the text emits
//   resolveCitations(refs, ids)  -> split refs into resolved / unresolved
//
// "Reference token" is intentionally broad so the same parser serves an
// evidence-ledger agent ([E1], [GAP-3]), a regulated agent (clause-id spans,
// "21 CFR 820.100"), or a generic assistant that cites bracketed source ids.

/** All inline reference tokens found in a piece of agent text. */
export interface ParsedCitations {
  /** Deduplicated reference strings, in first-seen order. */
  refs: string[];
}

// Bracketed evidence/source tags: [E1], [E12], [GAP-3], [S4]. Excludes
// reasoning markers like [INFERENCE: ...] / [GAP: ...] (they are not citations).
// We require the bracket body to be a short id token (no spaces, no colon).
const BRACKET_TAG_RE = /\[([A-Za-z]+-?\d+)\]/g;

// Regulatory clause spans: <span class="citation" data-clause-id="X">...</span>.
// Capture the clause id; tolerate any attribute order and either quote style.
const CLAUSE_SPAN_RE =
  /<span\b[^>]*\bclass=["']citation\b[^"']*["'][^>]*\bdata-clause-id=["']([^"']+)["'][^>]*>/gi;

// Inline regulation citations in prose: "21 CFR 820.100", "ISO 13485:2016".
// These double as both a claim subject (claims.ts) and a resolvable reference.
const INLINE_REG_RE = /\b\d+\s*CFR\s*(?:Part\s*)?\d+(?:\.\d+(?:\([a-z\d]+\))*)?|\bISO\s+\d+(?:[-:]?\d{4})?/gi;

/**
 * Extract every inline reference token from `text`. Pure parsing - no
 * resolution, no DB. Order is first-seen; duplicates are dropped.
 */
export function parseCitations(text: string): ParsedCitations {
  const seen = new Set<string>();
  const refs: string[] = [];
  const add = (raw: string | undefined): void => {
    if (!raw) return;
    const ref = raw.trim();
    if (ref.length === 0 || seen.has(ref)) return;
    seen.add(ref);
    refs.push(ref);
  };

  for (const m of text.matchAll(BRACKET_TAG_RE)) add(m[1]);
  for (const m of text.matchAll(CLAUSE_SPAN_RE)) add(m[1]);
  for (const m of text.matchAll(INLINE_REG_RE)) add(m[0]);

  return { refs };
}

/**
 * Resolve a list of reference tokens against a set of known ids. Pure
 * set-membership: a ref resolves iff it appears in `knownIds`. Returns both
 * buckets so callers can report resolved coverage and flag unresolved refs.
 *
 * Order within each bucket follows `refs`; duplicates in `refs` collapse to one.
 */
export function resolveCitations(
  refs: string[],
  knownIds: Iterable<string>,
): { resolved: string[]; unresolved: string[] } {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (known.has(ref)) resolved.push(ref);
    else unresolved.push(ref);
  }
  return { resolved, unresolved };
}
