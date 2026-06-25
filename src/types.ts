/**
 * Shared types for tfcleaner.
 */

export type ItemKind = 'terragrunt-cache' | 'terraform' | 'lock-file';

/** A single reclaimable item discovered by the scanner. */
export interface CleanItem {
  /** Display name, e.g. ".terragrunt-cache" */
  name: string;
  /** Absolute path to the item */
  path: string;
  /** Whether the item is a directory */
  isDir: boolean;
  /** Classification of the item */
  kind: ItemKind;
  /** Size in bytes */
  size: number;
  /** Number of files contained (1 for a single file) */
  files: number;
  /** The project/group this item belongs to (parent directory of interest) */
  group: string;
}

/** Items grouped under a project directory. */
export interface ProjectGroup {
  /** Directory that groups the items (e.g. ~/projects/payment-api) */
  path: string;
  items: CleanItem[];
}

/** Result of a cleanup operation for a single item. */
export interface CleanResult {
  item: CleanItem;
  ok: boolean;
  error?: string;
}
