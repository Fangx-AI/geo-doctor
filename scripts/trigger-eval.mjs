#!/usr/bin/env node
// Trigger eval for the six skills in skills/.
//
// A client decides whether to load a skill from its frontmatter description
// alone. A description that reads well but does not carry the words users
// actually say silently never fires, and no unit test notices, because the
// SKILL.md is still valid YAML with all its links intact.
//
// Two modes:
//
//   node scripts/trigger-eval.mjs                 # 结构检查，不联网、不需要 key
//   node scripts/trigger-eval.mjs --judge "claude -p"   # 用本地 CLI 当裁判，量触发率
//
// The judge reads one prompt on stdin and prints the name of the skill it would
// load (or none). Any local CLI that answers on stdout works; no API key is
// configured here, and this script never calls a network API itself.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const EVALS = join(ROOT, 'evals', 'triggers');

export function loadSkills(root = ROOT) {
  const dir = join(root, 'skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = join(dir, d.name, 'SKILL.md');
      if (!existsSync(file)) return null;
      const text = readFileSync(file, 'utf8');
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return null;
      const line = m[1].split(/\r?\n/).find((l) => l.startsWith('description:'));
      if (!line) return null;
      let description = line.slice('description:'.length).trim();
      if (description.startsWith("'") && description.endsWith("'")) {
        description = description.slice(1, -1).replace(/''/g, "'");
      } else if (description.startsWith('"') && description.endsWith('"')) {
        description = description.slice(1, -1);
      }
      return { name: d.name, description };
    })
    .filter(Boolean);
}

export function loadCases(file = join(EVALS, 'prompts.json')) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cases)) throw new Error(`${file}: missing cases[]`);
  return data.cases;
}

// Structural check: does the eval set itself make sense? This is what CI runs.
export function checkTriggers(root = ROOT) {
  const problems = [];
  const skills = loadSkills(root);
  const names = new Set(skills.map((s) => s.name));
  const sets = ['prompts.json', 'heldout.json'];
  const seen = new Map();
  let total = 0;

  for (const set of sets) {
    const file = join(root, 'evals', 'triggers', set);
    let cases;
    try {
      cases = loadCases(file);
    } catch (err) {
      problems.push(`${set}: ${err.message}`);
      continue;
    }
    total += cases.length;

    for (const c of cases) {
      const where = `${set}:${c.id ?? '(no id)'}`;
      if (!c.id) problems.push(`${where}: missing id`);
      if (typeof c.prompt !== 'string' || !c.prompt.trim()) problems.push(`${where}: missing prompt`);
      if (seen.has(c.prompt)) problems.push(`${where}: duplicate prompt of ${seen.get(c.prompt)}`);
      else seen.set(c.prompt, where);
      if (c.expect !== null && !names.has(c.expect)) {
        problems.push(`${where}: expect "${c.expect}" is not a directory under skills/`);
      }
    }

    const ids = cases.map((c) => c.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) problems.push(`${set}: duplicate case ids`);
  }

  for (const skill of skills) {
    const own = loadCases(join(root, 'evals', 'triggers', 'prompts.json')).filter(
      (c) => c.expect === skill.name,
    );
    if (own.length < 3) {
      problems.push(`${skill.name}: only ${own.length} development cases (need at least 3)`);
    }
  }

  const nulls = loadCases(join(root, 'evals', 'triggers', 'prompts.json')).filter((c) => c.expect === null);
  if (nulls.length < 3) problems.push(`only ${nulls.length} cases expect no skill (need at least 3)`);

  return { ok: problems.length === 0, problems, skills: skills.length, cases: total };
}

// One judge prompt: the descriptions a client would see, plus one user message.
export function judgePrompt(skills, prompt) {
  const menu = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return `你要从下面这些技能里挑一个来响应用户。

${menu}

规则：
1. 只输出技能名，不要输出别的字。
2. 如果没有一个技能该被触发，输出 none。
3. 不要解释。

用户说：${prompt}

技能名：`;
}

export function parseAnswer(text, names) {
  if (typeof text !== 'string') return 'unresolved';
  const cleaned = text.replace(/[`*\s]/g, ' ').trim();
  if (!cleaned) return 'unresolved';
  const lower = cleaned.toLowerCase();
  if (/^none\b|\bnone$/.test(lower.replace(/^[^a-z]+/, ''))) return null;
  const hits = [...names].filter((n) => new RegExp(`(^|[^a-z-])${n}([^a-z-]|$)`, 'i').test(lower));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return 'unresolved';
  if (/\bnone\b/.test(lower)) return null;
  return 'unresolved';
}

function runJudge(command, prompt, timeoutMs) {
  const res = spawnSync(command, {
    shell: true,
    input: prompt,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.error) return { error: res.error.message };
  if (res.status !== 0) {
    return { error: `judge exited ${res.status}: ${(res.stderr || '').trim().slice(0, 200)}` };
  }
  return { text: res.stdout || '' };
}

function score(cases, skills, command, timeoutMs, log) {
  const names = new Set(skills.map((s) => s.name));
  const rows = new Map();
  for (const name of names) rows.set(name, { hit: 0, miss: 0, wrong: 0, total: 0 });
  let correct = 0;
  let unresolved = 0;
  let falsePositive = 0;
  let negatives = 0;
  const misses = [];

  for (const c of cases) {
    const res = runJudge(command, judgePrompt(skills, c.prompt), timeoutMs);
    if (res.error) return { error: res.error };
    const got = parseAnswer(res.text, names);
    if (got === 'unresolved') unresolved += 1;

    if (c.expect === null) {
      negatives += 1;
      if (got !== null && got !== 'unresolved') falsePositive += 1;
      if (got === null) correct += 1;
      continue;
    }

    const row = rows.get(c.expect);
    row.total += 1;
    if (got === c.expect) {
      row.hit += 1;
      correct += 1;
    } else {
      row.miss += 1;
      if (got !== null && got !== 'unresolved' && names.has(got)) rows.get(got).wrong += 1;
      misses.push({ id: c.id, prompt: c.prompt, expect: c.expect, got });
    }
    if (log) log(`  ${got === c.expect ? 'ok  ' : 'MISS'} ${c.id} → ${got ?? 'none'}`);
  }

  return { rows, correct, total: cases.length, unresolved, negatives, falsePositive, misses };
}

function render(result, title) {
  const lines = [`## ${title}`, '', `| 技能 | 命中 | 漏触发 | 误触发 | 召回 |`, `| --- | --- | --- | --- | --- |`];
  for (const [name, r] of result.rows) {
    const recall = r.total ? `${Math.round((r.hit / r.total) * 100)}%` : '—';
    lines.push(`| ${name} | ${r.hit}/${r.total} | ${r.miss} | ${r.wrong} | ${recall} |`);
  }
  lines.push(
    '',
    `总体：**${result.correct}/${result.total}**（${Math.round((result.correct / result.total) * 100)}%）；` +
      `不该触发时误触发 ${result.falsePositive}/${result.negatives}；未解析 ${result.unresolved}`,
  );
  if (result.misses.length) {
    lines.push('', '漏掉的用例：');
    for (const m of result.misses) lines.push(`- ${m.id}（期望 ${m.expect}，得到 ${m.got ?? 'none'}）：${m.prompt}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };

  const check = checkTriggers(ROOT);
  if (!check.ok) {
    console.error('触发用例本身有问题：');
    for (const p of check.problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const command = flag('--judge');
  if (!command) {
    console.log(`结构检查通过：${check.skills} 个技能、${check.cases} 条用例（开发集 + 门槛集）。`);
    console.log('');
    console.log('要量触发率，用一个本地 CLI 当裁判（它从 stdin 读一个问题，只回答技能名）：');
    console.log('  node scripts/trigger-eval.mjs --judge "claude -p"');
    console.log('  node scripts/trigger-eval.mjs --judge "claude -p" --report evals/triggers/report.md');
    return;
  }

  const skills = loadSkills(ROOT);
  const timeoutMs = Number(flag('--timeout') || 120000);
  const limit = Number(flag('--limit') || 0);
  const which = flag('--set') || 'both';
  const sections = [];
  const pick = (cases) => (limit > 0 ? cases.slice(0, limit) : cases);

  if (which !== 'heldout') {
    const cases = pick(loadCases(join(EVALS, 'prompts.json')));
    console.log(`开发集 ${cases.length} 条…`);
    const r = score(cases, skills, command, timeoutMs, console.log);
    if (r.error) {
      console.error(`裁判跑不起来：${r.error}`);
      process.exit(2);
    }
    sections.push(render(r, `开发集（${cases.length} 条）`));
  }
  if (which !== 'prompts') {
    const cases = pick(loadCases(join(EVALS, 'heldout.json')));
    console.log(`门槛集 ${cases.length} 条…`);
    const r = score(cases, skills, command, timeoutMs, console.log);
    if (r.error) {
      console.error(`裁判跑不起来：${r.error}`);
      process.exit(2);
    }
    sections.push(render(r, `门槛集（${cases.length} 条）`));
  }

  const report = sections.join('\n\n');
  console.log('\n' + report);
  const out = flag('--report');
  if (out) {
    const head = [
      `- 时间：${new Date().toISOString()}`,
      `- 裁判：\`${command}\``,
      `- 用例：开发集 ${check.cases} 条口径（本次 ${which === 'heldout' ? '仅门槛集' : which === 'prompts' ? '仅开发集' : '两个集'}${limit > 0 ? `，各取前 ${limit} 条` : ''}）`,
    ].join('\n');
    writeFileSync(out, `# 技能触发率\n\n${head}\n\n${report}\n`, 'utf8');
    console.log(`\n写入 ${out}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('trigger-eval.mjs')) {
  main(process.argv.slice(2));
}
