// Loads backend/.env (if it exists) into process.env BEFORE anything else reads configuration.
// Real environment variables always win over the file, so Render/Docker settings are never overridden.
// No dependency: a tiny KEY=VALUE parser (supports # comments, "quoted" and 'quoted' values).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');               // trailing comment on an unquoted value
    out[m[1]] = v;
  }
  return out;
}

export function loadEnv(file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), env = process.env) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const set = [];
  for (const [k, v] of Object.entries(parseEnv(text))) if (env[k] === undefined && v !== '') { env[k] = v; set.push(k); }
  return set;                                           // names only — values are never printed
}

loadEnv();
