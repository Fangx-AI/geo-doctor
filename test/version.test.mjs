// A client caches a skill, a plugin and an npx invocation by their version string.
// When the copies disagree, the user quietly keeps running the old one, so this test
// fails the moment any copy drifts away from package.json.
//
// Fix with `npm run sync-version` (or let `npm version` do it through its lifecycle script).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkVersions } from '../scripts/sync-version.mjs';

test('every published copy of the version matches package.json', () => {
  assert.deepEqual(
    checkVersions(),
    [],
    'these copies disagree with package.json — run: npm run sync-version',
  );
});
