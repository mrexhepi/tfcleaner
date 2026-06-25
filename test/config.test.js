import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { expandHome, defaultPaths, DEFAULT_IGNORE } from '../dist/config.js';

test('expandHome expands a leading tilde', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/projects'), path.join(os.homedir(), 'projects'));
  assert.equal(expandHome('/abs/path'), '/abs/path');
});

test('defaultPaths includes cwd and home, deduped', () => {
  const paths = defaultPaths('/some/cwd');
  assert.ok(paths.includes(path.resolve('/some/cwd')));
  assert.ok(paths.includes(os.homedir()));
  // When cwd === home, only one entry.
  const same = defaultPaths(os.homedir());
  assert.equal(same.length, 1);
});

test('DEFAULT_IGNORE contains common build/vendor dirs', () => {
  for (const d of ['.git', 'node_modules', 'vendor', 'dist', 'build']) {
    assert.ok(DEFAULT_IGNORE.includes(d), `${d} ignored`);
  }
});
