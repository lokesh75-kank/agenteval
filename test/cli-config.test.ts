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

describe('eval config failures', () => {
  it('works without a config', () => {
    expect(cli(fixture(),['eval','--traces','traces.json','scenarios']).status).toBe(0);
  });
  it('surfaces malformed discovered YAML', () => {
    const dir = fixture(); writeFileSync(join(dir,'agenteval.config.yaml'),'scenarios: [');
    const result = cli(dir,['eval','--traces','traces.json','scenarios']);
    expect(result.status).toBe(1); expect(result.stderr).toContain('scenarios: [');
  });
  it('surfaces import errors instead of ignoring configuration', () => {
    const dir = fixture(); writeFileSync(join(dir,'agenteval.config.mjs'), `throw new Error('config import failed')`);
    const result = cli(dir,['eval','--traces','traces.json','scenarios']);
    expect(result.status).toBe(1); expect(result.stderr).toContain('config import failed');
  });
  it('supports explicit scenarios-only configs over implicit config', () => {
    const dir = fixture(); writeFileSync(join(dir,'agenteval.config.mjs'), `throw new Error('ignored')`);
    writeFileSync(join(dir,'custom.yaml'), 'scenarios: ./scenarios');
    expect(cli(dir,['eval','--config','custom.yaml','--traces','traces.json']).status).toBe(0);
  });
  it('still fails when an explicit config is absent', () => {
    expect(cli(fixture(),['eval','--config','absent.yaml','--traces','traces.json','scenarios']).status).toBe(1);
  });
});
