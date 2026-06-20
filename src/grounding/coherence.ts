// Cross-section coherence: orphan-reference detection.
//
// When an agent drafts a multi-section document, a tag can be referenced across
// sections without any single section owning (defining) it: a "PA-2" cited in a
// Q&A section but missing from Preventive Actions, an "[E5]" referenced in
// several sections but never introduced. Such cross-section tags are exactly
// the references the drafting agents cannot self-verify, since each agent owns
// only its own slice. This deterministic pass surfaces them as evidence gaps.
//
// Domain-agnostic: it has no owner map, so it flags any tag that spans two or
// more sections. The reported shape is the generic { tag, referencingSectionIds }.

/** One section of a multi-part document. */
export interface CoherenceSection {
  id: string;
  title: string;
  content: string;
}

/** A tag whose references span multiple sections with no single owner. */
export interface OrphanReference {
  /** The reference tag, e.g. "PA-2" or "E5". */
  tag: string;
  /** Section ids that referenced the tag, deduped and sorted. */
  referencingSectionIds: string[];
}

// Default tag shape: a hyphenated multi-letter prefix (CA-1, PA-2, RC-3, GAP-7)
// OR a short single-letter+digits evidence tag (E5, R3). Requiring the hyphen
// for multi-letter prefixes is what keeps ordinary all-caps-plus-digit prose
// (FIGURE2, TABLE3, PART820, ISO9001) from being mistaken for reference tags
// and reported as fabricated orphan references. Group 0 is the full tag.
const TAG_RE = /\b(?:[A-Z]{2,5}-\d+|[A-Z]\d+)\b/g;

/**
 * Strip HTML tags before scanning so attribute values (e.g.
 * `data-evidence-id="E1"`) never satisfy a tag pattern. Only the content
 * references a reader actually sees should count.
 */
function stripTags(html: string): string {
  return String(html ?? '').replace(/<[^>]*>/g, ' ');
}

/** All distinct tags appearing in a body. */
function findTags(body: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(TAG_RE.source, TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.add(m[0]);
  }
  return out;
}

/**
 * Find tags that appear in two or more sections. These cross-section tags have
 * no single owning section, so a reader cannot verify the tag was defined where
 * it should be - a "referenced but never defined in an authoritative section" check.
 *
 * Tags confined to a single section are treated as locally defined and trusted
 * (they are both introduced and used in the same place), so they are not
 * reported.
 *
 * Returns orphans sorted by tag for deterministic gap creation.
 */
export function findOrphanReferences(
  sections: CoherenceSection[],
): OrphanReference[] {
  // tag -> set of section ids it appears in
  const sectionsByTag = new Map<string, Set<string>>();

  for (const s of sections) {
    const body = stripTags(s.content);
    for (const tag of findTags(body)) {
      let set = sectionsByTag.get(tag);
      if (!set) {
        set = new Set<string>();
        sectionsByTag.set(tag, set);
      }
      set.add(s.id);
    }
  }

  const orphans: OrphanReference[] = [];
  for (const [tag, sectionIds] of sectionsByTag) {
    if (sectionIds.size >= 2) {
      orphans.push({
        tag,
        referencingSectionIds: [...sectionIds].sort(),
      });
    }
  }

  orphans.sort((a, b) => a.tag.localeCompare(b.tag));
  return orphans;
}
