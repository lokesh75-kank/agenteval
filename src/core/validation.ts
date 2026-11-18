import type { Scenario, Assertion } from './types.js';

/** Validate external scenario data before an agent is executed. */
export function validateScenario(raw: unknown, sourcePath?: string): Scenario {
  const where = sourcePath ? ` (${sourcePath})` : '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid scenario${where}: expected a YAML object`);
  }
  const o = raw as Record<string, unknown>;
  const fail = (detail: string): never => { throw new Error(`Invalid scenario "${String(o.id ?? '')}"${where}: ${detail}`); };
  if (typeof o.id !== 'string' || !o.id.trim()) fail('missing string "id"');
  const input = o.input as Record<string, unknown> | undefined;
  if (!input || typeof input.user_message !== 'string') fail('missing input.user_message');
  if (!Array.isArray(o.asserts)) fail('"asserts" must be a list');
  for (const [index, assertion] of (o.asserts as unknown[]).entries()) {
    const problem = assertionProblem(assertion);
    if (problem) fail(`assertion ${index + 1}: ${problem}`);
  }
  return raw as Scenario;
}

function assertionProblem(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'expected an assertion object';
  const a = raw as Record<string, unknown>;
  const string = (key: string) => typeof a[key] === 'string';
  const list = (key: string) => Array.isArray(a[key]) && (a[key] as unknown[]).every(v => typeof v === 'string');
  const count = (key: string) => typeof a[key] === 'number' && Number.isSafeInteger(a[key]) && (a[key] as number) >= 0;
  const optionalString = (key: string) => a[key] === undefined || string(key);
  switch (a.kind as Assertion['kind']) {
    case 'tool_called': case 'tool_not_called':
      if (!string('name')) return 'name must be a string';
      if (a.args_match !== undefined && (!a.args_match || typeof a.args_match !== 'object' || Array.isArray(a.args_match))) return 'args_match must be an object';
      break;
    case 'tool_input_contains_one_of':
      if (!optionalString('tool')) return 'tool must be a string';
      if (!list('options')) return 'options must be a list of strings';
      break;
    case 'text_contains_one_of': case 'output_contains_one_of':
      if (!list('options')) return 'options must be a list of strings';
      break;
    case 'text_does_not_contain':
      if (!list('patterns')) return 'patterns must be a list of strings';
      break;
    case 'text_contains':
      if (!string('pattern') || !optionalString('flags')) return 'pattern and optional flags must be strings';
      break;
    case 'iteration_count_under': case 'iteration_count_at_least':
      if (!count('n')) return 'n must be a non-negative safe integer';
      break;
    case 'recall_at_k':
      if (!list('expected') || !count('k')) return 'expected must be a list of strings and k a non-negative safe integer';
      if (a.all !== undefined && typeof a.all !== 'boolean') return 'all must be a boolean';
      break;
    case 'every_claim_has_citation': case 'citations_resolve': case 'quote_matches_source': case 'refusal': break;
    default: return `unknown assertion kind ${String(a.kind)}`;
  }
  return undefined;
}
