/**
 * Live per-run quality metric for one signed record.
 *
 * Computed at sign time by diffing the agent's draft against the human-signed
 * final document, so the validation gate can be measured:
 *   - first-pass acceptance: the human signed without editing the agent's draft
 *   - edit distance: how much the human changed (char-level, off a word LCS)
 *   - citation validity: share of the signed text's references that resolve
 *     (live inline refs vs broken [E?]/[GAP?] markers) + ungrounded claims
 *   - refusal/gap count: declared gaps on the record (passed by the caller)
 *
 * Pure and text-only on purpose (no DB), so it is deterministic and unit-
 * tested. Citation health is read off the signed artifact's own markers rather
 * than re-resolving against the corpus, which keeps capture cheap at sign time.
 */
import { createHash } from 'node:crypto';
import { parseCitations, detectUncitedClaims } from '../grounding/index.js';

export interface RecordMetricInput {
  /**
   * The agent's finalized draft. Either a stringified document JSON
   * (`{ sections: { id: { title, content } } }`) or plain text.
   */
  agentDraftDocument: string;
  /** The human-signed final, same shape as `agentDraftDocument`. */
  finalDocument: string;
  /** Declared gaps on the record (caller counts; defaults to 0). */
  refusalGapCount?: number;
}

export interface ComputedRecordMetric {
  firstPassAcceptance: boolean;
  editDistance: number;
  editDistancePct: number;
  citationValidityPct: number;
  ungroundedClaimCount: number;
  agentDraftHash: string;
  finalDocumentHash: string;
}

/**
 * Concatenate section content in a stable (key-sorted) order so the diff is
 * deterministic. Falls back to the raw string when the input is not the
 * structured document JSON we expect.
 */
function extractText(documentJson: string): string {
  try {
    const doc = JSON.parse(documentJson) as {
      sections?: Record<string, { content?: string }>;
    };
    const sections = doc.sections;
    if (!sections || typeof sections !== 'object') {
      return (documentJson ?? '').trim();
    }
    return Object.keys(sections)
      .sort()
      .map((k) => sections[k]?.content ?? '')
      .join('\n\n')
      .trim();
  } catch {
    return (documentJson ?? '').trim();
  }
}

/** Collapse runs of whitespace so trivial reformatting is not counted as an edit. */
const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Pure char-level edit distance via a word-level longest-common-subsequence:
 * count the chars in words the human removed plus the chars in words the human
 * added. Bounded - records are at most a few hundred words, so the O(n*m) DP is
 * cheap. We use a word LCS (not Levenshtein over chars) because the meaningful
 * unit of human editing is the word, and it keeps the table small.
 */
function editDistance(a: string, b: string): number {
  const aw = a.split(/\s+/).filter(Boolean);
  const bw = b.split(/\s+/).filter(Boolean);
  const n = aw.length;
  const m = bw.length;
  if (n === 0) return b.length;
  if (m === 0) return a.length;

  // dp[i][j] = length of the LCS of aw[0..i) and bw[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    const ai = aw[i - 1] as string;
    const row = dp[i] as number[];
    const prev = dp[i - 1] as number[];
    for (let j = 1; j <= m; j++) {
      row[j] =
        ai === (bw[j - 1] as string)
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, row[j - 1] as number);
    }
  }

  // Walk back to mark which words are common; the rest are removed/added.
  let i = n;
  let j = m;
  const commonA = new Array<boolean>(n).fill(false);
  const commonB = new Array<boolean>(m).fill(false);
  while (i > 0 && j > 0) {
    const prev = dp[i - 1] as number[];
    const cur = dp[i] as number[];
    if ((aw[i - 1] as string) === (bw[j - 1] as string)) {
      commonA[i - 1] = true;
      commonB[j - 1] = true;
      i--;
      j--;
    } else if ((prev[j] as number) >= (cur[j - 1] as number)) {
      i--;
    } else {
      j--;
    }
  }

  let removed = 0;
  for (let k = 0; k < n; k++) if (!commonA[k]) removed += (aw[k] as string).length;
  let added = 0;
  for (let k = 0; k < m; k++) if (!commonB[k]) added += (bw[k] as string).length;
  return removed + added;
}

function sha256(s: string): string {
  return createHash('sha256').update(s ?? '').digest('hex');
}

export function computeRecordMetric(input: RecordMetricInput): ComputedRecordMetric {
  const agentText = extractText(input.agentDraftDocument);
  const finalText = extractText(input.finalDocument);

  const firstPassAcceptance = normalize(agentText) === normalize(finalText);
  const distance = firstPassAcceptance ? 0 : editDistance(agentText, finalText);
  const editDistancePct = finalText.length > 0 ? distance / finalText.length : 0;

  // Live, resolvable references parsed from the signed artifact's own markers.
  const { refs } = parseCitations(finalText);
  const liveRefs = refs.length;
  // Broken placeholders the agent left behind that the human never resolved.
  const brokenMarkers =
    (finalText.match(/\[E\?\]/g)?.length ?? 0) +
    (finalText.match(/\[GAP\?\]/g)?.length ?? 0);
  const totalRefs = liveRefs + brokenMarkers;
  const ungroundedClaimCount = detectUncitedClaims(finalText).length;

  return {
    firstPassAcceptance,
    editDistance: distance,
    editDistancePct,
    // No references at all reads as trivially valid (nothing to break).
    citationValidityPct: totalRefs > 0 ? liveRefs / totalRefs : 1,
    ungroundedClaimCount,
    agentDraftHash: sha256(input.agentDraftDocument),
    finalDocumentHash: sha256(input.finalDocument),
  };
}
