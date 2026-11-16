// Keeps every published version string in one place: package.json.
//
// A skill's frontmatter, the plugin manifest and each CLI's `-v` all carry a version,
// and they had drifted apart: package.json said 1.8.0, `geo-audit -v` said 1.2.0,
// and the skill told the client 0.9.0. A client caches a skill by its version, so a
// stale one is invisible in the worst way: the user believes they run the new copy.
//
//   node scripts/sync-version.mjs          rewrite every copy from package.json
//   node scripts/sync-version.mjs --check  exit 1 listing the copies that disagree
//
// `npm version` runs it through the "version" lifecycle script, and test/version.test.mjs
// runs --check on every `npm test`.
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listScripts(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => `${dir}/${f}`);
}

// One (version) group per pattern. The bundled copies are compared byte for byte
// against cli/ by test/skill.test.mjs, so both sides are rewritten here.
// cli/proxy.mjs is a shim with no VERSION export, so scanned files are optional:
// a missing export means "not a version carrier", not drift.
const TARGETS = [
  ...listScripts('cli').map((file) => ({ file, re: /(export const VERSION = ')([^']+)(';)/, optional: true })),
  ...listScripts('skills/geo-doctor/scripts').map((file) => ({ file, re: /(export const VERSION = ')([^']+)(';)/, optional: true })),
  { file: 'skills/geo-doctor/SKILL.md', re: /(^ {2}version: ")([^"]+)(")/m },
  { file: '.claude-plugin/plugin.json', re: /("version": ")([^"]+)(")/ },
  { file: '.claude-plugin/marketplace.json', re: /("version": ")([^"]+)(")/ },
];

function packageVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// Every copy that does not carry package.json's version, as { file, found }.
export function checkVersions() {
  const want = packageVersion();
  const drift = [];
  for (const { file, re, optional } of TARGETS) {
    let text;
    try {
      text = read(file);
    } catch {
      drift.push({ file, found: 'missing' });
      continue;
    }
    const m = text.match(re);
    if (!m) {
      if (!optional) drift.push({ file, found: 'no version field' });
    } else if (m[2] !== want) {
      drift.push({ file, found: m[2] });
    }
  }
  return drift;
}

export function syncVersions() {
  const want = packageVersion();
  const changed = [];
  for (const { file, re } of TARGETS) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (!re.test(text)) continue;
    const next = text.replace(re, `$1${want}$3`);
    if (next !== text) {
      writeFileSync(join(ROOT, file), next, 'utf8');
      changed.push(file);
    }
  }
  return { version: want, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const drift = checkVersions();
    if (drift.length) {
      const want = packageVersion();
      console.error(`package.json is ${want}; these copies disagree:\n`);
      for (const { file, found } of drift) console.error(`  ${file}: ${found}`);
      console.error('\nrun: npm run sync-version');
      process.exit(1);
    }
    console.log(`all ${TARGETS.length} version strings match package.json (${packageVersion()})`);
  } else {
    const { version, changed } = syncVersions();
    console.log(changed.length ? `set ${changed.length} file(s) to ${version}:\n  ${changed.join('\n  ')}` : `already at ${version}`);
  }
}
