/**
 * Configuration loading for tfcleaner.
 *
 * Reads ~/.tfcleanerrc (JSON) if present and merges with defaults.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

export interface TfCleanConfig {
  /** Directories to scan. Supports ~ expansion. */
  paths: string[];
  /** Directory names to ignore while scanning. */
  ignore: string[];
}

export const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
];

export const RC_FILENAME = '.tfcleanerrc';

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Path to the rc file. */
export function rcPath(): string {
  return path.join(os.homedir(), RC_FILENAME);
}

/**
 * Build the default set of scan paths: the current working directory and the
 * user's home directory (deduplicated).
 */
export function defaultPaths(cwd: string = process.cwd()): string[] {
  const home = os.homedir();
  const resolvedCwd = path.resolve(cwd);
  const paths = [resolvedCwd];
  if (path.resolve(home) !== resolvedCwd) paths.push(home);
  return paths;
}

/**
 * Load configuration, merging ~/.tfcleanerrc over sensible defaults.
 *
 * @param overridePaths Explicit paths (e.g. from CLI) that take precedence.
 */
export async function loadConfig(
  overridePaths?: string[],
): Promise<TfCleanConfig> {
  let fileConfig: Partial<TfCleanConfig> = {};

  const file = rcPath();
  if (await fs.pathExists(file)) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      fileConfig = JSON.parse(raw) as Partial<TfCleanConfig>;
    } catch (err) {
      throw new Error(
        `Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const rawPaths =
    overridePaths && overridePaths.length > 0
      ? overridePaths
      : fileConfig.paths && fileConfig.paths.length > 0
        ? fileConfig.paths
        : defaultPaths();

  const paths = Array.from(
    new Set(rawPaths.map((p) => path.resolve(expandHome(p)))),
  );

  const ignore = Array.from(
    new Set([...DEFAULT_IGNORE, ...(fileConfig.ignore ?? [])]),
  );

  return { paths, ignore };
}
