// Stable, pretty JSON renderer. "Stable" means object keys are emitted in a
// deterministic order regardless of construction order, so two runs that produce
// equal reports produce byte-identical JSON (useful for diffing and snapshots).

import type { SuiteReport } from '../core/types.js';

/**
 * Render a SuiteReport as pretty-printed, key-sorted JSON.
 *
 * Keys are sorted recursively so the output is deterministic and diff-friendly.
 * Arrays preserve their order (scenario / run / assertion order is meaningful).
 */
export function renderJson(report: SuiteReport): string {
  return `${JSON.stringify(report, sortedReplacer(), 2)}\n`;
}

/**
 * A JSON.stringify replacer that emits plain-object keys in sorted order.
 * Arrays and primitives are passed through unchanged (their order matters).
 */
function sortedReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  return function replacer(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        sorted[k] = obj[k];
      }
      return sorted;
    }
    return value;
  };
}
