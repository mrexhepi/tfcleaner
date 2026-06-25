/**
 * Size and file-count calculation.
 */
import fs from 'fs-extra';
import path from 'node:path';

export interface SizeInfo {
  size: number;
  files: number;
}

/**
 * Recursively compute the total size (in bytes) and file count of a path.
 * Symlinks are not followed (their own link size is counted, not the target).
 * Errors on individual entries (permission denied, broken symlinks) are
 * skipped so a single bad entry never aborts the whole calculation.
 */
export async function getSizeInfo(target: string): Promise<SizeInfo> {
  let size = 0;
  let files = 0;

  async function walk(p: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.lstat(p);
    } catch {
      return; // missing / permission denied / broken symlink
    }

    if (stat.isSymbolicLink()) {
      // Count the link itself, never traverse it.
      size += stat.size;
      files += 1;
      return;
    }

    if (stat.isDirectory()) {
      let entries: string[];
      try {
        entries = await fs.readdir(p);
      } catch {
        return;
      }
      await Promise.all(entries.map((e) => walk(path.join(p, e))));
      return;
    }

    if (stat.isFile()) {
      size += stat.size;
      files += 1;
    }
  }

  await walk(target);
  return { size, files };
}

/** Human-readable byte formatting (e.g. 4.2 GB, 800 MB, 20 KB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, i);
  const decimals = i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}
