import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadSkills,
  loadCases,
  checkTriggers,
  judgePrompt,
  parseAnswer,
} from '../scripts/trigger-eval.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the trigger eval set is internally consistent', () => {
  const result = checkTriggers(ROOT);
  assert.deepEqual(result.problems, [], result.problems.join('\n'));
  assert.equal(result.ok, true);
});

test('every skill has a description long enough to carry a trigger', () => {
  const skills = loadSkills(ROOT);
  assert.equal(skills.length, 6);
  for (const skill of skills) {
    assert.ok(skill.description.length > 120, `${skill.name}: description too short`);
    assert.match(skill.description, /[Uu]se when/, `${skill.name}: description never says when to use it`);
  }
});

test('both eval sets stay separate, so tuning cannot quietly consume the gate', () => {
  const dev = loadCases(join(ROOT, 'evals', 'triggers', 'prompts.json'));
  const held = loadCases(join(ROOT, 'evals', 'triggers', 'heldout.json'));
  const devPrompts = new Set(dev.map((c) => c.prompt));
  for (const c of held) {
    assert.equal(devPrompts.has(c.prompt), false, `${c.id} appears in both sets`);
  }
  assert.ok(held.length >= 12, 'the heldout set is too small to gate a change');
});

test('the judge prompt shows every skill and nothing else', () => {
  const skills = loadSkills(ROOT);
  const prompt = judgePrompt(skills, '为什么 ChatGPT 不提我的网站');
  for (const skill of skills) assert.ok(prompt.includes(`- ${skill.name}: `));
  assert.ok(prompt.includes('为什么 ChatGPT 不提我的网站'));
  assert.ok(prompt.trimEnd().endsWith('技能名：'));
});

test('answers are parsed into exactly one skill, none, or unresolved', () => {
  const names = new Set(['ai-visibility', 'geo-doctor', 'llms-txt']);
  assert.equal(parseAnswer('ai-visibility', names), 'ai-visibility');
  assert.equal(parseAnswer('  `geo-doctor`\n', names), 'geo-doctor');
  assert.equal(parseAnswer('我会用 geo-doctor 来处理。', names), 'geo-doctor');
  assert.equal(parseAnswer('none', names), null);
  assert.equal(parseAnswer('None.', names), null);
  assert.equal(parseAnswer('ai-visibility 和 geo-doctor 都行', names), 'unresolved');
  assert.equal(parseAnswer('', names), 'unresolved');
  assert.equal(parseAnswer('我不知道', names), 'unresolved');
});
