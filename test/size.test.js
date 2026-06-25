import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { getSizeInfo, formatBytes, formatAge } from '../dist/size.js';
import { makeTmp, writeFile } from './helpers.js';

test('getSizeInfo sums sizes and counts files recursively', async () => {
  const root = await makeTmp();
  try {
    await writeFile(path.join(root, 'a.bin'), '0'.repeat(100));
    await writeFile(path.join(root, 'sub', 'b.bin'), '0'.repeat(200));
    await writeFile(path.join(root, 'sub', 'deep', 'c.bin'), '0'.repeat(300));
    const info = await getSizeInfo(root);
    assert.equal(info.files, 3);
    assert.equal(info.size, 600);
    assert.ok(info.mtimeMs > 0, 'mtimeMs should be set');
  } finally {
    await fs.remove(root);
  }
});

test('getSizeInfo handles missing path gracefully', async () => {
  const info = await getSizeInfo('/no/such/path/xyz123');
  assert.deepEqual(info, { size: 0, files: 0, mtimeMs: 0 });
});

test('getSizeInfo does not follow symlinks', async () => {
  const root = await makeTmp();
  try {
    await writeFile(path.join(root, 'real', 'big.bin'), '0'.repeat(10000));
    const linkPath = path.join(root, 'link');
    await fs.symlink(path.join(root, 'real'), linkPath);
    const info = await getSizeInfo(linkPath);
    // Counts the link itself, not the 10000-byte target.
    assert.equal(info.files, 1);
    assert.ok(info.size < 10000);
  } finally {
    await fs.remove(root);
  }
});

test('formatBytes renders human-readable units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(20 * 1024), '20.0 KB');
  assert.equal(formatBytes(4.2 * 1024 ** 3).endsWith('GB'), true);
});

test('formatAge renders compact relative ages', () => {
  const now = 1_000_000_000_000;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  assert.equal(formatAge(0), '—');
  assert.equal(formatAge(now, now), 'now');
  assert.equal(formatAge(now - 5 * min, now), '5m');
  assert.equal(formatAge(now - 3 * hr, now), '3h');
  assert.equal(formatAge(now - 2 * day, now), '2d');
  assert.equal(formatAge(now - 40 * day, now), '1mo');
  assert.equal(formatAge(now - 400 * day, now), '1y');
});
