import fs from 'node:fs';

const GENERATED = 'docs/openapi.generated.json';
const OVERRIDES = 'docs/openapi.overrides.json';
const OUTPUT = 'docs/openapi.json';

// const ALLOW_PREFIXES = ['/class', '/class-assignment', '/teacher', '/project', '/student'];
const ALLOW_PREFIXES = [
  '/api/classes',
  '/api/class-assignment',
  '/api/teacher',
  '/api/project',
  '/api/student',
];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, patch) {
  if (Array.isArray(base) && Array.isArray(patch)) return patch;
  if (isObject(base) && isObject(patch)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return patch;
}

function filterPathsByPrefix(paths, prefixes) {
  const out = {};
  for (const [p, ops] of Object.entries(paths ?? {})) {
    if (prefixes.some((pre) => p.startsWith(pre))) out[p] = ops;
  }
  return out;
}

if (!fs.existsSync(GENERATED)) throw new Error(`Missing generated spec: ${GENERATED}`);
if (!fs.existsSync(OVERRIDES)) throw new Error(`Missing overrides file: ${OVERRIDES}`);

const base = JSON.parse(fs.readFileSync(GENERATED, 'utf8'));
const patch = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));

const merged = deepMerge(base, patch);

const baseFilteredPaths = filterPathsByPrefix(base.paths, ALLOW_PREFIXES);
merged.paths = { ...baseFilteredPaths, ...(patch.paths ?? {}) };

if (Array.isArray(merged.tags)) {
  const used = new Set();
  for (const ops of Object.values(merged.paths ?? {})) {
    for (const op of Object.values(ops ?? {})) {
      for (const t of op?.tags ?? []) used.add(t);
    }
  }
  merged.tags = merged.tags.filter((t) => used.has(t?.name));
}

fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`Merged OpenAPI (filtered) -> ${OUTPUT}`);
