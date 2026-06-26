/**
 * Scanner: walks the configured paths and finds Terraform/Terragrunt
 * generated artifacts.
 */
import fg from 'fast-glob';
import path from 'node:path';
import fs from 'fs-extra';
import type { TfCleanConfig } from './config.js';
import type { CleanItem, ItemKind, ProjectGroup } from './types.js';
import { getSizeInfo } from './size.js';

export interface ScanOptions {
  /** Compute sizes (can be slow). Defaults to true. */
  computeSizes?: boolean;
  /** Drop items smaller than this many bytes from the results. Defaults to 0. */
  minSize?: number;
}

// Only ever target generated directories. Lock files (.terraform.lock.hcl)
// are deliberately never matched — they must never be deleted.
const TARGET_DIRS: Record<string, ItemKind> = {
  '.terragrunt-cache': 'terragrunt-cache',
  '.terraform': 'terraform',
};

/** Map a discovered absolute path to an item kind, or null if not a target. */
function classify(absPath: string, isDir: boolean): ItemKind | null {
  const base = path.basename(absPath);
  if (isDir && base in TARGET_DIRS) return TARGET_DIRS[base];
  return null;
}

/**
 * Scan all configured paths for reclaimable items.
 */
export async function scan(
  config: TfCleanConfig,
  options: ScanOptions = {},
): Promise<CleanItem[]> {
  const { computeSizes = true, minSize = 0 } = options;

  // Build glob patterns — only the generated target directories.
  const dirNames = Object.keys(TARGET_DIRS);
  const patterns = dirNames.map((d) => `**/${d}`);

  const ignore = config.ignore.map((d) => `**/${d}/**`);

  const found = new Map<string, CleanItem>();

  for (const root of config.paths) {
    if (!(await fs.pathExists(root))) continue;

    const entries = await fg(patterns, {
      cwd: root,
      absolute: true,
      onlyFiles: false,
      dot: true,
      followSymbolicLinks: false,
      suppressErrors: true,
      ignore,
      // Do not descend into a target dir once matched.
      deep: Infinity,
    });

    for (const abs of entries) {
      const normalized = path.resolve(abs);
      if (found.has(normalized)) continue;

      let isDir: boolean;
      try {
        isDir = (await fs.lstat(normalized)).isDirectory();
      } catch {
        continue;
      }

      const kind = classify(normalized, isDir);
      if (!kind) continue;

      found.set(normalized, {
        name: path.basename(normalized),
        path: normalized,
        isDir,
        kind,
        size: 0,
        files: isDir ? 0 : 1,
        mtimeMs: 0,
        group: path.dirname(normalized),
      });
    }
  }

  const items = Array.from(found.values());

  // Avoid descending into nested targets: a .terraform inside a
  // .terragrunt-cache is already covered by the parent. Drop children whose
  // path is contained within another matched item's path.
  const deduped = dropNested(items);

  if (computeSizes) {
    await Promise.all(
      deduped.map(async (item) => {
        const info = await getSizeInfo(item.path);
        item.size = info.size;
        item.files = info.files;
        item.mtimeMs = info.mtimeMs;
      }),
    );
  }

  // Drop items below the size threshold (only meaningful once sizes exist).
  const filtered =
    computeSizes && minSize > 0
      ? deduped.filter((i) => i.size >= minSize)
      : deduped;

  // Sort by size descending for a useful default ordering.
  filtered.sort((a, b) => b.size - a.size);
  return filtered;
}

/** Remove items nested inside other matched items. */
function dropNested(items: CleanItem[]): CleanItem[] {
  const dirs = items
    .filter((i) => i.isDir)
    .map((i) => i.path)
    .sort((a, b) => a.length - b.length);

  return items.filter((item) => {
    for (const dir of dirs) {
      if (item.path === dir) continue;
      if (item.path.startsWith(dir + path.sep)) return false;
    }
    return true;
  });
}

/** Group items by their containing project directory. */
export function groupByProject(items: CleanItem[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const item of items) {
    let group = map.get(item.group);
    if (!group) {
      group = { path: item.group, items: [] };
      map.set(item.group, group);
    }
    group.items.push(item);
  }
  const groups = Array.from(map.values());
  // Sort groups by total size descending.
  const total = (g: ProjectGroup) =>
    g.items.reduce((sum, i) => sum + i.size, 0);
  groups.sort((a, b) => total(b) - total(a));
  return groups;
}

/** Sum of sizes across items. */
export function totalSize(items: CleanItem[]): number {
  return items.reduce((sum, i) => sum + i.size, 0);
}
