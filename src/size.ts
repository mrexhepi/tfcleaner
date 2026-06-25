/**
 * Size and file-count calculation.
 */
import fs from 'fs-extra';
import path from 'node:path';

export interface SizeInfo {
  size: number;
  files: number;
  /** Newest modification time found (ms epoch), 0 if unknown. */
  mtimeMs: number;
}

/**
 * Recursively compute the total size (in bytes), file count and newest
 * modification time of a path. Symlinks are not followed (their own link size
 * is counted, not the target). Errors on individual entries (permission
 * denied, broken symlinks) are skipped so a single bad entry never aborts the
 * whole calculation.
 */
export async function getSizeInfo(target: string): Promise<SizeInfo> {
  let size = 0;
  let files = 0;
  let mtimeMs = 0;

  async function walk(p: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.lstat(p);
    } catch {
      return; // missing / permission denied / broken symlink
    }

    if (stat.mtimeMs > mtimeMs) mtimeMs = stat.mtimeMs;

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
  return { size, files, mtimeMs };
}

/**
 * Compact relative age from a timestamp (ms epoch) to now.
 * e.g. "now", "5m", "3h", "2d", "3w", "5mo", "2y". Returns "—" if unknown.
 */
export function formatAge(mtimeMs: number, now: number = Date.now()): string {
  if (!mtimeMs || mtimeMs <= 0) return '—';
  const sec = Math.max(0, (now - mtimeMs) / 1000);
  if (sec < 60) return 'now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}h`;
  const day = hr / 24;
  if (day < 7) return `${Math.floor(day)}d`;
  const wk = day / 7;
  if (day < 30) return `${Math.floor(wk)}w`;
  const mo = day / 30;
  if (mo < 12) return `${Math.floor(mo)}mo`;
  return `${Math.floor(day / 365)}y`;
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
