import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agenteval-cli-')); dirs.push(dir);
  mkdirSync(join(dir, 'scenarios'));
  writeFileSync(join(dir, 'scenarios/one.yaml'), 'id: one\ninput: {user_message: hi}\nasserts: [{kind: text_contains, pattern: yes}]');
  writeFileSync(join(dir, 'traces.json'), JSON.stringify([{input:{user_message:'hi'},finalText:'yes',toolCalls:[]}]));
  return dir;
}
function cli(dir: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), resolve('src/cli/index.ts'), ...args], {cwd:dir, encoding:'utf8'});
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true}); });

describe('baseline CLI safety', () => {
  function configured() {
    const dir = fixture();
    writeFileSync(join(dir,'agenteval.config.mjs'), `export default {scenarios:'./scenarios',runs:1,adapter:{async run(input){return {input,finalText:'yes',toolCalls:[]}}}}`);
    writeFileSync(join(dir,'agenteval.baseline.json'), JSON.stringify({scenarios:{one:{pass:true,determinism:1},removed:{pass:true,determinism:1}}}));
    return dir;
  }
  it('fails when a baseline scenario is missing', () => {
    const result = cli(configured(), ['check']);
    expect(result.status).toBe(1); expect(result.stdout).toContain('removed: missing');
  });
  it.each(['run','baseline','check','eval'])('rejects empty %s evaluations', command => {
    const dir = configured(); rmSync(join(dir,'scenarios/one.yaml'));
    const result = cli(dir, command === 'eval' ? ['eval','--traces','traces.json','scenarios'] : [command]);
    expect(result.status).toBe(1); expect(result.stderr).toContain('No scenarios');
  });
  it('rejects duplicate IDs', () => {
    const dir = configured(); writeFileSync(join(dir,'scenarios/two.yaml'),'id: one\ninput: {user_message: hi}\nasserts: []');
    const result = cli(dir,['baseline']);
    expect(result.status).toBe(1); expect(result.stderr).toContain('Duplicate scenario ID');
  });
  it.each(['NaN','Infinity','-0.1','1.1',''])('rejects invalid tolerance %s', tolerance => {
    const result = cli(configured(),['check',`--tolerance=${tolerance}`]);
    expect(result.status).toBe(1); expect(result.stderr).toContain('Tolerance must');
  });
  it('rejects malformed baselines', () => {
    const dir = configured(); writeFileSync(join(dir,'agenteval.baseline.json'),'{}');
    expect(cli(dir,['check']).stderr).toContain('Invalid baseline');
  });
  it('passes unchanged comparisons and ignores new scenarios', () => {
    const dir = configured(); writeFileSync(join(dir,'agenteval.baseline.json'),JSON.stringify({scenarios:{one:{pass:true,determinism:1}}}));
    writeFileSync(join(dir,'scenarios/new.yaml'),'id: new\ninput: {user_message: hi}\nasserts: []');
    const result = cli(dir,['check']); expect(result.status).toBe(0); expect(result.stdout).toContain('No regressions');
  });
});
