import type { Scenario, SuiteReport } from '../core/types.js';

type Baseline = { scenarios: Record<string, { pass: boolean; determinism: number }> };

export function validateEvaluationScenarios(scenarios: Scenario[]): void {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('No scenarios to evaluate.');
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (typeof scenario?.id !== 'string' || !scenario.id.trim()) throw new Error('Scenario ID must be a non-empty string.');
    if (ids.has(scenario.id)) throw new Error(`Duplicate scenario ID: ${scenario.id}`);
    ids.add(scenario.id);
  }
}

export function validateBaseline(raw: unknown): Baseline {
  const scenarios = raw && typeof raw === 'object' ? (raw as Baseline).scenarios : undefined;
  if (!scenarios || typeof scenarios !== 'object' || Array.isArray(scenarios) || Object.keys(scenarios).length === 0) {
    throw new Error('Invalid baseline: expected a non-empty scenarios object.');
  }
  for (const [id, value] of Object.entries(scenarios)) {
    if (!id.trim() || !value || typeof value.pass !== 'boolean' || typeof value.determinism !== 'number' ||
      !Number.isFinite(value.determinism) || value.determinism < 0 || value.determinism > 1) {
      throw new Error(`Invalid baseline scenario: ${id}`);
    }
  }
  return { scenarios };
}

export function parseTolerance(raw: string): number {
  const tolerance = Number(raw);
  if (!raw.trim() || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error('Tolerance must be a finite number between 0 and 1.');
  }
  return tolerance;
}

export function compareBaseline(baseline: Baseline, report: SuiteReport, tolerance: number): string[] {
  const regressions: string[] = [];
  const current = new Map(report.scenarios.map(s => [s.scenarioId, s]));
  for (const [id, base] of Object.entries(baseline.scenarios)) {
    const s = current.get(id);
    if (!s) regressions.push(`${id}: missing from current evaluation`);
    else if (base.pass && !s.pass) regressions.push(`${id}: was passing, now failing`);
    else if (base.determinism - s.determinism > tolerance) {
      regressions.push(`${id}: determinism dropped ${(base.determinism * 100).toFixed(0)}% -> ${(s.determinism * 100).toFixed(0)}%`);
    }
  }
  return regressions;
}
