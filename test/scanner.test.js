import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { scan, groupByProject, totalSize } from '../dist/scanner.js';
import { DEFAULT_IGNORE } from '../dist/config.js';
import { makeTmp, buildFixture } from './helpers.js';

function cfg(root) {
  return { paths: [root], ignore: DEFAULT_IGNORE };
}

test('finds .terraform and .terragrunt-cache directories', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    const names = items.map((i) => i.name).sort();
    assert.ok(names.includes('.terraform'));
    assert.ok(names.includes('.terragrunt-cache'));
    // Two .terragrunt-cache + one .terraform = 3 (lock excluded by default).
    assert.equal(items.length, 3);
  } finally {
    await fs.remove(root);
  }
});

test('excludes lock files by default, includes them with flag', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const without = await scan(cfg(root));
    assert.ok(!without.some((i) => i.kind === 'lock-file'));

    const withLock = await scan(cfg(root), { includeLockFiles: true });
    assert.ok(withLock.some((i) => i.kind === 'lock-file'));
  } finally {
    await fs.remove(root);
  }
});

test('respects ignore rules (node_modules)', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    assert.ok(
      !items.some((i) => i.path.includes(`${path.sep}node_modules${path.sep}`)),
      'should not include items under node_modules',
    );
  } finally {
    await fs.remove(root);
  }
});

test('computes sizes and file counts', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    const tg = items.find(
      (i) => i.kind === 'terragrunt-cache' && i.path.includes('payment-api'),
    );
    assert.ok(tg);
    assert.ok(tg.size >= 2000);
    assert.equal(tg.files, 1);
    assert.ok(totalSize(items) > 0);
  } finally {
    await fs.remove(root);
  }
});

test('groups items by project directory', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    const groups = groupByProject(items);
    const groupNames = groups.map((g) => path.basename(g.path)).sort();
    assert.deepEqual(groupNames, ['auth-service', 'payment-api']);
  } finally {
    await fs.remove(root);
  }
});
