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

describe('replay report provenance', () => {
  it.each([undefined, 0.75])('preserves threshold %s with heterogeneous sample counts', threshold => {
    const dir = fixture();
    writeFileSync(join(dir,'scenarios/two.yaml'),'id: two\ninput: {user_message: bye}\nasserts: []');
    writeFileSync(join(dir,'traces.json'),JSON.stringify([
      {input:{user_message:'hi'},finalText:'yes',toolCalls:[]},
      {input:{user_message:'bye'},finalText:'yes',toolCalls:[]},
      {input:{user_message:'bye'},finalText:'yes',toolCalls:[]},
    ]));
    if (threshold !== undefined) writeFileSync(join(dir,'agenteval.config.yaml'),`passThreshold: ${threshold}`);
    const result = cli(dir,['eval','scenarios','--traces','traces.json','--json','report.json','--html','report.html']);
    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));
    expect(report.replayConfig.passThreshold).toBe(threshold ?? 2/3);
    expect(report.scenarios.map((s: {totalRuns:number}) => s.totalRuns)).toEqual([1,2]);
    expect(readFileSync(join(dir,'report.html'),'utf8')).toContain('Recorded sample counts vary');
    expect(readFileSync(join(dir,'report.html'),'utf8')).toContain('Scenario pass threshold');
  });
});
