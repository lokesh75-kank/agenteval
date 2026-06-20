// Uncited-claim detection.
//
// Catches the largest single grounding failure mode: an agent asserts a rule
// ("Per 21 CFR 820.100, manufacturers shall ...", "Studies show 80% of users
// must ...") without an attached citation. We catch it at the regex layer -
// no model call, no DB hit - so it can run inside any post-generation pass at
// effectively zero latency.
//
// Pure generalization of Deminn's regulatoryClaimDetector: the regex set moved
// into config.ts (GroundingConfig.claimPatterns + imperativeMarkers) so the
// same algorithm serves a regulated domain or a generic assistant.

import type { GroundingConfig } from './config.js';
import { GENERIC_PRESET } from './config.js';

/** A sentence that asserts a claim but carries no nearby citation. */
export interface UncitedClaim {
  /** The full sentence containing the claim. */
  sentence: string;
  /** The claim-subject pattern text that matched (e.g. "21 CFR 820.100"). */
  pattern: string;
  /** Char offset of the matched subject within the source text. */
  offset: number;
}

// Already-cited regions. We mask these out before scanning so a claim that IS
// wrapped in a citation span is not double-counted as uncited. Tolerates any
// attribute order and single or double quotes.
const CITATION_SPAN_RE =
  /<span\b[^>]*\bclass=["']citation\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi;

/**
 * Find claims in `text` that are not enclosed in a citation span.
 *
 * Strategy:
 *   1. Mask any text already inside a `<span class="citation">...</span>`,
 *      replacing it with equal-length whitespace so char offsets stay valid.
 *   2. Split the masked text into sentences (terminator-aware: does not split
 *      inside numbers like "820.100", abbreviations like "e.g.", or versions).
 *   3. For each sentence containing an imperative marker AND a claim pattern,
 *      record one violation.
 *
 * Returns an empty array when every claim is properly cited.
 */
export function detectUncitedClaims(
  text: string,
  config: GroundingConfig = GENERIC_PRESET,
): UncitedClaim[] {
  const masked = maskCitationSpans(text);
  const sentences = splitIntoSentences(masked);
  const imperative = buildImperativeRegex(config.imperativeMarkers);

  const violations: UncitedClaim[] = [];
  for (const { sentence, offset } of sentences) {
    if (!imperative.test(sentence)) continue;

    for (const pattern of config.claimPatterns) {
      // Defensive: callers may share global regexes, so reset lastIndex.
      pattern.lastIndex = 0;
      const match = pattern.exec(sentence);
      if (!match) continue;
      violations.push({
        sentence: sentence.trim(),
        pattern: match[0].trim(),
        offset: offset + match.index,
      });
      break; // one violation per sentence is enough
    }
  }

  return violations;
}

/** Build a single case-insensitive word-boundary alternation of markers. */
function buildImperativeRegex(markers: string[]): RegExp {
  if (markers.length === 0) {
    // Match nothing: an empty marker set means "no claims are detectable".
    return /(?!)/;
  }
  const escaped = markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

function maskCitationSpans(text: string): string {
  return text.replace(CITATION_SPAN_RE, (m) => ' '.repeat(m.length));
}

interface SentenceRange {
  sentence: string;
  offset: number;
}

function splitIntoSentences(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = text[i + 1];
    // A terminator is a real boundary only when followed by whitespace or EOS.
    // "820.100" / "e.g." / "v1.2" stay glued to their parent sentence.
    if (next !== undefined && !/\s/.test(next)) continue;
    const sentence = text.slice(start, i + 1);
    if (sentence.trim().length > 0) {
      ranges.push({ sentence, offset: start });
    }
    start = i + 1;
  }
  // Tail fragment without a terminator (model can end mid-sentence under a
  // token budget).
  if (start < text.length) {
    const tail = text.slice(start);
    if (tail.trim().length > 0) {
      ranges.push({ sentence: tail, offset: start });
    }
  }
  return ranges;
}
