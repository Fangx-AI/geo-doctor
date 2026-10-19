// Checks that skills/ follows the Agent Skills format used by Claude Code, Codex, Kimi, TRAE and WorkBuddy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = 'skills';
const skills = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must start with YAML frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

for (const name of skills) {
  const dir = join(ROOT, name);
  const md = readFileSync(join(dir, 'SKILL.md'), 'utf8');

  test(`${name}: frontmatter is portable`, () => {
    const fm = frontmatter(md);
    assert.equal(fm.name, name, 'name must match the directory');
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fm.name.length <= 64);
    assert.ok(fm.description && fm.description.length <= 1024, 'description 1–1024 chars');
    for (const key of Object.keys(fm)) assert.ok(['name', 'description', 'license', 'metadata'].includes(key), `unsupported key ${key}`);
    assert.ok(md.split('\n').length <= 500, 'SKILL.md should stay under 500 lines');
  });

  test(`${name}: relative links resolve inside the skill`, () => {
    const files = [join(dir, 'SKILL.md'), ...readdirSync(join(dir, 'references')).map((f) => join(dir, 'references', f))];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const [, href] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/i.test(href)) continue;
        const target = resolve(dirname(f), href);
        assert.ok(existsSync(target), `${f} links to missing ${href}`);
        assert.ok(target.startsWith(resolve(dir)), `${f} links outside the skill: ${href}`);
      }
    }
  });
}

for (const script of ['geo-audit.mjs', 'geo-publish.mjs', 'geo-probe.mjs', 'geo-site.mjs']) {
  test(`bundled ${script} matches cli/${script}`, () => {
    assert.equal(readFileSync(`skills/geo-doctor/scripts/${script}`, 'utf8'), readFileSync(`cli/${script}`, 'utf8'),
      `run: cp cli/${script} skills/geo-doctor/scripts/`);
  });
}

test('each skill ships its own license file for the standalone zip', () => {
  for (const name of skills) {
    const fm = frontmatter(readFileSync(join(ROOT, name, 'SKILL.md'), 'utf8'));
    if (fm.license === 'MIT') assert.match(readFileSync(join(ROOT, name, 'LICENSE'), 'utf8'), /^MIT License/);
  }
});

test('every fact-card entry carries an id, a source or address, and a status', () => {
  const yaml = readFileSync('skills/geo-doctor/assets/fact-card.yaml', 'utf8');
  const entries = yaml.split(/\n  - /).slice(1).map((e) => e.split(/\n(?=\S)/)[0]);
  assert.ok(entries.length >= 20);
  for (const e of entries) {
    assert.match(e, /^编号: [A-Z]\d\d/, e);
    assert.match(e, /\n {4}(来源|地址): /, e);
    assert.match(e, /\n {4}状态: /, e);
  }
});
