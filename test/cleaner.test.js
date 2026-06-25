import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { scan } from '../dist/scanner.js';
import { clean, assertSafe } from '../dist/cleaner.js';
import { DEFAULT_IGNORE } from '../dist/config.js';
import { makeTmp, buildFixture } from './helpers.js';

function cfg(root) {
  return { paths: [root], ignore: DEFAULT_IGNORE };
}

test('dry-run deletes nothing but reports totals', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    const summary = await clean(items, { dryRun: true });

    assert.equal(summary.removedItems, items.length);
    assert.ok(summary.freedBytes > 0);

    // Everything must still exist.
    for (const item of items) {
      assert.ok(await fs.pathExists(item.path), `${item.path} should remain`);
    }
  } finally {
    await fs.remove(root);
  }
});

test('clean actually removes target items', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    const summary = await clean(items);

    assert.equal(summary.failures.length, 0);
    for (const item of items) {
      assert.ok(!(await fs.pathExists(item.path)), `${item.path} removed`);
    }
    // Source file and state file untouched.
    assert.ok(
      await fs.pathExists(path.join(root, 'payment-api', 'main.tf')),
    );
    assert.ok(
      await fs.pathExists(path.join(root, 'keep', 'terraform.tfstate')),
    );
  } finally {
    await fs.remove(root);
  }
});

test('assertSafe refuses protected and non-target paths', () => {
  assert.throws(() =>
    assertSafe({
      name: 'terraform.tfstate',
      path: '/x/terraform.tfstate',
      isDir: false,
      kind: 'lock-file',
      size: 1,
      files: 1,
      group: '/x',
    }),
  );
  assert.throws(() =>
    assertSafe({
      name: 'main.tf',
      path: '/x/main.tf',
      isDir: false,
      kind: 'lock-file',
      size: 1,
      files: 1,
      group: '/x',
    }),
  );
  assert.throws(() =>
    assertSafe({
      name: 'src',
      path: '/x/src',
      isDir: true,
      kind: 'terraform',
      size: 1,
      files: 1,
      group: '/x',
    }),
  );
  // Valid target should not throw.
  assert.doesNotThrow(() =>
    assertSafe({
      name: '.terraform',
      path: '/x/.terraform',
      isDir: true,
      kind: 'terraform',
      size: 1,
      files: 1,
      group: '/x',
    }),
  );
});

test('clean continues after a failure', async () => {
  const root = await makeTmp();
  try {
    await buildFixture(root);
    const items = await scan(cfg(root));
    // Inject an unsafe item that will fail assertSafe.
    const bad = {
      name: 'main.tf',
      path: path.join(root, 'payment-api', 'main.tf'),
      isDir: false,
      kind: 'lock-file',
      size: 10,
      files: 1,
      group: path.join(root, 'payment-api'),
    };
    const summary = await clean([bad, ...items]);
    assert.equal(summary.failures.length, 1);
    assert.ok(summary.removedItems >= items.length);
    // The .tf must still exist (it was refused).
    assert.ok(await fs.pathExists(bad.path));
  } finally {
    await fs.remove(root);
  }
});
