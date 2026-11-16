// Checks that skills/ follows the Agent Skills format used by Claude Code, Codex, Kimi, TRAE and WorkBuddy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = 'skills';
const skills = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());

function frontmatter(md) {
  // Read files as text, so a Windows checkout (CRLF) parses the same as CI (LF).
  md = md.replace(/\r\n/g, '\n');
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must start with YAML frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

// The parser above is deliberately simple, and a strict YAML parser — the one the
// skills CLI and plugin marketplaces use — is not: it rejects a plain (unquoted)
// scalar containing ": ", reading it as a nested mapping, and then skips the whole
// skill without installing anything. That is how a description with
// "(generative engine optimization): use when" made the skill uninstallable while
// every test here passed. These are the plain-scalar rules that matter for us.
function scalarSurvivesYaml(value) {
  if (/^'[\s\S]*'$/.test(value)) return !value.slice(1, -1).includes("'");
  if (/^"[\s\S]*"$/.test(value)) return true;
  if (value.includes(': ')) return false;
  if (/ #/.test(value)) return false;
  return !/^[[\]{}*&!|>%@`]/.test(value);
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

  test(`${name}: frontmatter survives a strict YAML parser`, () => {
    const fm = frontmatter(md);
    for (const [key, value] of Object.entries(fm)) {
      assert.ok(scalarSurvivesYaml(value), `${key} is not a valid YAML scalar (quote it, or drop ": " from it)`);
    }
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

// Each skill bundles only the script its own job needs, plus the proxy shim every
// CLI imports. Both must stay byte-identical to cli/, or the skill quietly ships a
// different tool than the CLI users install.
const BUNDLED = {
  'ai-crawler-audit': ['geo-audit.mjs'],
  'ai-visibility': ['geo-probe.mjs'],
  'llms-txt': ['geo-site.mjs'],
  'geo-publish': ['geo-publish.mjs'],
  'geo-doctor': ['geo-autopilot.mjs'],
};

for (const [skill, scripts] of Object.entries(BUNDLED)) {
  for (const script of [...scripts, 'proxy.mjs']) {
    test(`bundled ${skill}/${script} matches cli/${script}`, () => {
      assert.equal(readFileSync(`skills/${skill}/scripts/${script}`, 'utf8'), readFileSync(`cli/${script}`, 'utf8'),
        `run: cp cli/${script} skills/${skill}/scripts/`);
    });
  }
}

// A skill cannot link outside its own directory, so the shared references are copied.
// Copies drift; this is the guard.
for (const shared of ['ai-sources-cn.md', 'ai-sources-global.md', 'compliance.md']) {
  test(`every copy of ${shared} is identical`, () => {
    const copies = [];
    for (const name of skills) {
      const file = join(ROOT, name, 'references', shared);
      if (existsSync(file)) copies.push([name, readFileSync(file, 'utf8').replace(/\r\n/g, '\n')]);
    }
    assert.ok(copies.length >= 2, `${shared} should be shared by at least two skills`);
    const [, first] = copies[0];
    for (const [name, text] of copies) assert.equal(text, first, `${name}/references/${shared} drifted from ${copies[0][0]}`);
  });
}

test('each skill ships its own license file for the standalone zip', () => {
  for (const name of skills) {
    const fm = frontmatter(readFileSync(join(ROOT, name, 'SKILL.md'), 'utf8'));
    if (fm.license === 'MIT') assert.match(readFileSync(join(ROOT, name, 'LICENSE'), 'utf8'), /^MIT License/);
  }
});

test('every skill has a references directory with at least one file', () => {
  for (const name of skills) {
    const files = readdirSync(join(ROOT, name, 'references'));
    assert.ok(files.length > 0, `${name}/references is empty`);
  }
});

test('every fact-card entry carries an id, a source or address, and a status', () => {
  const yaml = readFileSync('skills/ai-content-writer/assets/fact-card.yaml', 'utf8');
  const entries = yaml.split(/\n  - /).slice(1).map((e) => e.split(/\n(?=\S)/)[0]);
  assert.ok(entries.length >= 20);
  for (const e of entries) {
    assert.match(e, /^编号: [A-Z]\d\d/, e);
    assert.match(e, /\n {4}(来源|地址): /, e);
    assert.match(e, /\n {4}状态: /, e);
  }
});
