import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
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

describe('LangGraph CLI evaluation', () => {
  it.each([false, true])('scores recorded runs with envelope=%s', envelope => {
    const dir = fixture();
    const runs = ['yes','no','yes'].map(content => [
      { agent: { messages: [{ type: 'human', content: 'hi' }, { type: 'ai', content }] } },
    ]);
    writeFileSync(join(dir,'traces.json'), JSON.stringify(envelope ? {traces:runs} : runs));
    const result = cli(dir,['eval','scenarios','--traces','traces.json','--format','langgraph','--json','report.json','--html','report.html']);
    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));
    expect(report.scenarios[0]).toMatchObject({totalRuns:3, passingRuns:2, determinism:2/3});
    expect(readFileSync(join(dir,'report.html'),'utf8')).toContain('one');
  });
  it('fails visibly when no trace matches the scenario', () => {
    const dir = fixture(); writeFileSync(join(dir,'traces.json'),JSON.stringify([[{type:'human',content:'different'}]]));
    expect(cli(dir,['eval','scenarios','--traces','traces.json','--format','langgraph']).status).toBe(1);
  });
});
