/**
 * Cleaner: safely deletes selected items.
 */
import fs from 'fs-extra';
import path from 'node:path';
import type { CleanItem, CleanResult } from './types.js';

/** Names/patterns that must never be deleted by tfcleaner. */
const FORBIDDEN_BASENAMES = new Set([
  'terraform.tfstate',
  'terraform.tfstate.backup',
  // Lock files are never deletable by this tool.
  '.terraform.lock.hcl',
]);

const FORBIDDEN_EXTENSIONS = new Set(['.tf', '.tfvars']);

// tfcleaner only ever deletes these generated directories. Nothing else —
// and never any file (lock files, state files, sources are all protected).
const ALLOWED_DIRS = new Set(['.terragrunt-cache', '.terraform']);

/**
 * Guard: confirm an item is safe to delete. Throws if it violates safety
 * rules. This is the last line of defense regardless of how the item was
 * selected. Only generated directories are ever allowed; files are never
 * deleted.
 */
export function assertSafe(item: CleanItem): void {
  const base = path.basename(item.path);
  const ext = path.extname(base);

  if (FORBIDDEN_BASENAMES.has(base)) {
    throw new Error(`Refusing to delete protected file: ${base}`);
  }
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new Error(`Refusing to delete source file: ${base}`);
  }

  if (!item.isDir) {
    throw new Error(`Refusing to delete file: ${base}`);
  }
  if (!ALLOWED_DIRS.has(base)) {
    throw new Error(`Refusing to delete non-target directory: ${base}`);
  }
}

export interface CleanOptions {
  /** If true, do not actually delete; just report what would happen. */
  dryRun?: boolean;
  /** Called after each item is processed. */
  onProgress?: (result: CleanResult, index: number, total: number) => void;
}

export interface CleanSummary {
  results: CleanResult[];
  removedItems: number;
  removedFiles: number;
  freedBytes: number;
  failures: CleanResult[];
  durationMs: number;
}

/**
 * Delete the given items. Continues on error so one failure never aborts the
 * whole run. Respects safety rules via assertSafe.
 */
export async function clean(
  items: CleanItem[],
  options: CleanOptions = {},
): Promise<CleanSummary> {
  const { dryRun = false, onProgress } = options;
  const start = Date.now();

  const results: CleanResult[] = [];
  let removedItems = 0;
  let removedFiles = 0;
  let freedBytes = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let result: CleanResult;

    try {
      assertSafe(item);

      if (!dryRun) {
        // remove handles missing paths gracefully and recurses into dirs.
        await fs.remove(item.path);
      }

      result = { item, ok: true };
      removedItems += 1;
      removedFiles += item.files;
      freedBytes += item.size;
    } catch (err) {
      result = {
        item,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);
    onProgress?.(result, i, items.length);
  }

  const failures = results.filter((r) => !r.ok);

  return {
    results,
    removedItems,
    removedFiles,
    freedBytes,
    failures,
    durationMs: Date.now() - start,
  };
}
