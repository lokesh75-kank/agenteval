import { describe, it, expect, vi } from 'vitest';
import { parseScenario, loadScenarios } from './loader.js';
import { runSuite } from './runner.js';
import type { Scenario } from './types.js';

describe('scenario assertion validation', () => {
  it.each([
    { kind: 'text_contains' }, { kind: 'text_contains_one_of', options: 'yes' },
    { kind: 'iteration_count_under', n: -1 }, { kind: 'recall_at_k', expected: [], k: NaN },
    { kind: 'unknown' }, null,
  ])('rejects malformed assertion %j', async assertion => {
    const scenario = { id: 'bad', input: { user_message: 'hi' }, asserts: [assertion] };
    expect(() => parseScenario(JSON.stringify(scenario), 'bad.yaml')).toThrow(/bad.*bad.yaml.*assertion 1/);
    const run = vi.fn();
    await expect(runSuite({ run }, [scenario as Scenario])).rejects.toThrow('assertion 1');
    expect(run).not.toHaveBeenCalled();
  });
  it('validates all scenarios before executing any agent', async () => {
    const run = vi.fn();
    await expect(runSuite({ run }, [
      { id: 'ok', input: { user_message: 'hi' }, asserts: [] },
      { id: 'bad', input: { user_message: 'hi' }, asserts: [{ kind: 'text_contains' }] } as Scenario,
    ])).rejects.toThrow('pattern');
    expect(run).not.toHaveBeenCalled();
  });
  it('accepts the existing benchmark and judge-only scenarios', () => {
    expect(loadScenarios('bench/regulated').length).toBeGreaterThan(0);
    expect(parseScenario('id: judge\ninput: {user_message: hi}\nasserts: []\njudge: {rubric: helpful}').asserts).toEqual([]);
  });
});
