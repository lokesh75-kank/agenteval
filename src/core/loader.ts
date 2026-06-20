// Scenario loading from YAML.
//
// A scenario file is one Scenario (see core/types.ts) serialized as YAML. A
// directory of *.yaml files, or a manifest.yaml listing files, both load to a
// flat Scenario[]. No fixed directory layout or domain coupling.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';

import type { Scenario } from './types.js';

/** Parse + minimally validate one Scenario from a YAML string. */
export function parseScenario(yamlText: string, sourcePath?: string): Scenario {
  const raw = parse(yamlText) as unknown;
  return validateScenario(raw, sourcePath);
}

/** Load a single scenario file. */
export function loadScenario(path: string): Scenario {
  return parseScenario(readFileSync(path, 'utf8'), path);
}

/**
 * Load scenarios from a path that may be:
 *   - a single .yaml scenario file,
 *   - a directory of .yaml scenario files (a manifest.yaml, if present, is
 *     skipped as metadata),
 *   - a manifest.yaml whose `scenarios:` lists relative file paths.
 */
export function loadScenarios(path: string): Scenario[] {
  const st = statSync(path);
  if (st.isDirectory()) {
    return loadFromDirectory(path);
  }
  if (path.endsWith('manifest.yaml') || path.endsWith('manifest.yml')) {
    return loadFromManifest(path);
  }
  return [loadScenario(path)];
}

function loadFromDirectory(dir: string): Scenario[] {
  const files = readdirSync(dir)
    .filter(
      (f) =>
        (f.endsWith('.yaml') || f.endsWith('.yml')) &&
        f !== 'manifest.yaml' &&
        f !== 'manifest.yml',
    )
    .sort();
  return files.map((f) => loadScenario(join(dir, f)));
}

function loadFromManifest(manifestPath: string): Scenario[] {
  const raw = parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { scenarios?: unknown }).scenarios)
      ? ((raw as { scenarios: unknown[] }).scenarios)
      : [];
  const base = dirname(manifestPath);
  const out: Scenario[] = [];
  for (const entry of list) {
    const rel = typeof entry === 'string' ? entry : (entry as { file?: string }).file;
    if (!rel) continue;
    const p = isAbsolute(rel) ? rel : resolve(base, rel);
    out.push(loadScenario(p));
  }
  return out;
}

function validateScenario(raw: unknown, sourcePath?: string): Scenario {
  const where = sourcePath ? ` (${sourcePath})` : '';
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid scenario${where}: expected a YAML object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new Error(`Invalid scenario${where}: missing string "id"`);
  }
  const input = o.input as Record<string, unknown> | undefined;
  if (!input || typeof input.user_message !== 'string') {
    throw new Error(`Invalid scenario "${o.id}"${where}: missing input.user_message`);
  }
  if (!Array.isArray(o.asserts)) {
    throw new Error(`Invalid scenario "${o.id}"${where}: "asserts" must be a list`);
  }
  return raw as Scenario;
}
