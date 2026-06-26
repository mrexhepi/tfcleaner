/**
 * Interactive terminal UI (Ink) for tfcleaner — a polished, ncdu/lazygit-style
 * dashboard with bordered panels, size gauges and type icons.
 *
 * Cleaning happens inline: pressing `c` deletes the selected items and marks
 * their rows as deleted right in the list (no separate screens).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import type { TfCleanConfig } from './config.js';
import type { CleanItem, ItemKind } from './types.js';
import { scan, groupByProject, totalSize } from './scanner.js';
import { clean } from './cleaner.js';
import { formatBytes, formatAge } from './size.js';

interface AppProps {
  config: TfCleanConfig;
  minSize?: number;
}

type Phase = 'loading' | 'browse' | 'error';
type RowStatus = 'normal' | 'cleaning' | 'deleted' | 'failed';

interface HeaderRow {
  type: 'header';
  path: string;
  groupBytes: number;
}
interface ItemRow {
  type: 'item';
  item: CleanItem;
}
type Row = HeaderRow | ItemRow;

/** Min/max inner content width. Actual width adapts to the terminal. */
const MIN_WIDTH = 60;
const MAX_WIDTH = 400;
const GAUGE_WIDTH = 12;

/** Current terminal column count (falls back to 80 when unknown / 0). */
function termCols(): number {
  return process.stdout.columns || 80;
}

/** Inner content width, sized to the terminal (leaves room for border/padding). */
function contentWidth(cols: number): number {
  return Math.max(MIN_WIDTH, Math.min(cols - 6, MAX_WIDTH));
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const KIND_META: Record<ItemKind, { label: string; icon: string; color: string }> =
  {
    'terragrunt-cache': { label: '.terragrunt-cache', icon: '◆', color: 'magenta' },
    terraform: { label: '.terraform', icon: '▲', color: 'cyan' },
  };

function buildRows(items: CleanItem[]): Row[] {
  const groups = groupByProject(items);
  const rows: Row[] = [];
  for (const g of groups) {
    rows.push({
      type: 'header',
      path: g.path,
      groupBytes: g.items.reduce((s, i) => s + i.size, 0),
    });
    for (const item of g.items) rows.push({ type: 'item', item });
  }
  return rows;
}

/** Truncate a path from the left so the tail (most useful part) stays visible. */
function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}

/** Fit a string to an exact width (pad right or truncate with ellipsis). */
function fit(s: string, width: number): string {
  if (s.length === width) return s;
  if (s.length < width) return s + ' '.repeat(width - s.length);
  return s.slice(0, Math.max(0, width - 1)) + '…';
}

/** Build a proportional bar gauge string of fixed width. */
function gauge(value: number, max: number, width = GAUGE_WIDTH): string {
  if (max <= 0) return '·'.repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return (
    '█'.repeat(Math.min(filled, width)) +
    '·'.repeat(Math.max(0, width - filled))
  );
}

/** Number of list rows visible at once, based on terminal height. */
function visibleRowCount(): number {
  const rows = process.stdout.rows ?? 24;
  return Math.max(5, Math.min(22, rows - 11));
}

export function App({
  config,
  minSize = 0,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string>('');
  const [items, setItems] = useState<CleanItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [frame, setFrame] = useState(0);
  const [cols, setCols] = useState(termCols());

  // Inline-clean bookkeeping.
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [cleaningPaths, setCleaningPaths] = useState<Set<string>>(new Set());
  const [freed, setFreed] = useState(0);
  const [busy, setBusy] = useState(false);
  // Two-step delete: first `c` arms, second `c` confirms.
  const [confirming, setConfirming] = useState(false);

  // Spinner animation while loading or cleaning.
  useEffect(() => {
    if (phase !== 'loading' && !busy) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [phase, busy]);

  // Track terminal resizes so the panel always fills the available width.
  useEffect(() => {
    const onResize = () => setCols(termCols());
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  // Auto-cancel an armed delete confirmation after a few seconds of inaction.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(id);
  }, [confirming]);

  const width = contentWidth(cols);

  // Initial scan.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await scan(config, { minSize });
        if (cancelled) return;
        setItems(found);
        const builtRows = buildRows(found);
        setRows(builtRows);
        const firstItem = builtRows.findIndex((r) => r.type === 'item');
        setCursor(firstItem === -1 ? 0 : firstItem);
        setPhase('browse');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, minSize]);

  const isLive = (p: string) => !deleted.has(p);

  const liveItems = useMemo(
    () => items.filter((i) => isLive(i.path)),
    [items, deleted],
  );
  const selectedItems = useMemo(
    () => liveItems.filter((i) => selected.has(i.path)),
    [liveItems, selected],
  );
  const selectedBytes = useMemo(() => totalSize(selectedItems), [selectedItems]);
  const reclaimable = useMemo(() => totalSize(liveItems), [liveItems]);
  const maxItemSize = useMemo(
    () => items.reduce((m, i) => Math.max(m, i.size), 0),
    [items],
  );

  const maxVisible = visibleRowCount();
  const start = useMemo(() => {
    if (rows.length <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    return Math.min(Math.max(0, cursor - half), rows.length - maxVisible);
  }, [rows.length, maxVisible, cursor]);
  const visibleRows = rows.slice(start, start + maxVisible);
  const moreAbove = start > 0;
  const moreBelow = start + maxVisible < rows.length;

  const rowStatus = (item: CleanItem): RowStatus => {
    if (cleaningPaths.has(item.path)) return 'cleaning';
    if (deleted.has(item.path)) return 'deleted';
    if (failed.has(item.path)) return 'failed';
    return 'normal';
  };

  const moveCursor = (dir: 1 | -1) => {
    if (rows.length === 0) return;
    let next = cursor;
    for (let n = 0; n < rows.length; n++) {
      next = (next + dir + rows.length) % rows.length;
      const r = rows[next];
      if (r.type === 'item' && isLive(r.item.path)) break;
    }
    setCursor(next);
  };

  const goToEdge = (edge: 'first' | 'last') => {
    if (rows.length === 0) return;
    const liveIdx = rows
      .map((r, i) => (r.type === 'item' && isLive(r.item.path) ? i : -1))
      .filter((i) => i !== -1);
    if (liveIdx.length === 0) return;
    setCursor(edge === 'first' ? liveIdx[0] : liveIdx[liveIdx.length - 1]);
  };

  const toggleSelect = () => {
    const row = rows[cursor];
    if (!row || row.type !== 'item' || !isLive(row.item.path)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.item.path)) next.delete(row.item.path);
      else next.add(row.item.path);
      return next;
    });
  };

  const selectAll = () => {
    setSelected((prev) =>
      prev.size === liveItems.length
        ? new Set()
        : new Set(liveItems.map((i) => i.path)),
    );
  };

  /** Delete selected items in place, marking each row as it completes. */
  const cleanSelected = async () => {
    if (busy) return;
    const targets = selectedItems;
    if (targets.length === 0) return;

    setConfirming(false);
    setBusy(true);
    setCleaningPaths(new Set(targets.map((t) => t.path)));

    await clean(targets, {
      onProgress: (res) => {
        const p = res.item.path;
        setCleaningPaths((prev) => {
          const n = new Set(prev);
          n.delete(p);
          return n;
        });
        setSelected((prev) => {
          const n = new Set(prev);
          n.delete(p);
          return n;
        });
        if (res.ok) {
          setDeleted((prev) => new Set(prev).add(p));
          setFreed((prev) => prev + res.item.size);
        } else {
          setFailed((prev) => new Map(prev).set(p, res.error ?? 'failed'));
        }
      },
    });

    setCleaningPaths(new Set());
    setBusy(false);
    // Nudge the cursor onto a still-live row if it landed on a deleted one.
    const cur = rows[cursor];
    if (cur && cur.type === 'item' && !isLive(cur.item.path)) moveCursor(1);
  };

  useInput((input, key) => {
    if (phase === 'loading') return;

    if (phase === 'error') {
      if (input === 'q' || key.return || key.escape) exit();
      return;
    }

    // browse
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (busy) return; // ignore edits while a clean is running

    // Two-step delete: first `c` arms confirmation, second `c` commits.
    if (input.toLowerCase() === 'c') {
      if (selectedItems.length === 0) return;
      if (confirming) {
        setConfirming(false);
        void cleanSelected();
      } else {
        setConfirming(true);
      }
      return;
    }

    // Any other key cancels a pending confirmation.
    if (confirming) {
      setConfirming(false);
      if (key.escape) return; // Esc only cancels; don't also act
    }

    if (key.upArrow || input === 'k') moveCursor(-1);
    else if (key.downArrow || input === 'j') moveCursor(1);
    else if (key.pageUp || input === 'g') goToEdge('first');
    else if (key.pageDown || input === 'G') goToEdge('last');
    else if (input === ' ') toggleSelect();
    else if (input.toLowerCase() === 'a') selectAll();
  });

  if (!isRawModeSupported) {
    return (
      <Text color="red">
        Interactive mode requires a TTY. Use `tfcleaner scan` or `tfcleaner clean`
        instead.
      </Text>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Panel borderColor="cyan" width={width}>
        <Title />
        <Box marginTop={1}>
          <Text color="cyan">{SPINNER[frame]} </Text>
          <Text dimColor>Scanning for reclaimable files…</Text>
        </Box>
      </Panel>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <Panel borderColor="red" width={width}>
        <Text color="red" bold>
          ✗ Error
        </Text>
        <Text>{error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press q to quit.</Text>
        </Box>
      </Panel>
    );
  }

  // ── Browse (with inline cleaning) ─────────────────────────────────────────
  const allLiveSelected =
    liveItems.length > 0 && selected.size === liveItems.length;
  const noneLeft = items.length > 0 && liveItems.length === 0;

  const borderColor = confirming ? 'red' : busy ? 'yellow' : 'cyan';

  return (
    <Panel borderColor={borderColor} width={width}>
      <Box justifyContent="space-between" width={width}>
        <Text color="cyan" bold>
          ⬢ Terraform Cleaner
        </Text>
        <Text dimColor>{busy ? `${SPINNER[frame]} cleaning…` : `${liveItems.length} items`}</Text>
      </Box>

      {/* Stats strip */}
      <Box width={width}>
        <Text>
          <Text dimColor>reclaimable </Text>
          <Text bold color="cyan">{formatBytes(reclaimable)}</Text>
        </Text>
        {selected.size > 0 && (
          <Text>
            <Text dimColor>   selected </Text>
            <Text bold color="green">{selected.size}</Text>
            <Text dimColor> · </Text>
            <Text bold color="green">{formatBytes(selectedBytes)}</Text>
          </Text>
        )}
        {freed > 0 && (
          <Text>
            <Text dimColor>   freed </Text>
            <Text bold color="green">{formatBytes(freed)}</Text>
          </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {rows.length === 0 ? (
          <Text color="green">Nothing to clean. You're all tidy! ✨</Text>
        ) : (
          <>
            <Text dimColor>{moreAbove ? '   ▲ more' : ' '}</Text>
            {visibleRows.map((row, i) => {
              const idx = start + i;
              if (row.type === 'header') {
                return (
                  <Box
                    key={`h:${row.path}`}
                    width={width}
                    justifyContent="space-between"
                  >
                    <Text color="blue" bold wrap="truncate">
                      {' '}📁 {truncatePath(row.path, width - 16)}
                    </Text>
                    <Text dimColor>{formatBytes(row.groupBytes)}</Text>
                  </Box>
                );
              }
              return (
                <ItemLine
                  key={row.item.path}
                  item={row.item}
                  isCursor={idx === cursor}
                  isSelected={selected.has(row.item.path)}
                  maxSize={maxItemSize}
                  status={rowStatus(row.item)}
                  spinner={SPINNER[frame]}
                  error={failed.get(row.item.path)}
                  width={width}
                />
              );
            })}
            <Text dimColor>{moreBelow ? '   ▼ more' : ' '}</Text>
          </>
        )}
      </Box>

      {noneLeft && (
        <Box marginTop={1}>
          <Text color="green" bold>✓ All clean — freed {formatBytes(freed)}</Text>
        </Box>
      )}

      {confirming && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ⚠ Delete {selected.size} item(s) · {formatBytes(selectedBytes)}?{' '}
          </Text>
          <Text color="yellow" bold>press c again</Text>
          <Text dimColor> to confirm · any other key cancels</Text>
        </Box>
      )}

      {/* Footer / keybar */}
      <Box
        width={width}
        marginTop={1}
        borderStyle="single"
        borderColor="gray"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text dimColor wrap="truncate">
          <Key k="↑↓" d="move" /> <Key k="g/G" d="ends" />{' '}
          <Key k="space" d={allLiveSelected ? 'none' : 'pick'} />{' '}
          <Key k="a" d="all" /> <Key k="c" d={confirming ? 'confirm' : 'clean'} />{' '}
          <Key k="q" d="quit" />
        </Text>
      </Box>
    </Panel>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────

function Panel({
  children,
  borderColor,
  width,
}: {
  children: React.ReactNode;
  borderColor: string;
  width: number;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={width + 4}
    >
      {children}
    </Box>
  );
}

function Title(): React.JSX.Element {
  return (
    <Text color="cyan" bold>
      ⬢ Terraform Cleaner
    </Text>
  );
}

function Key({ k, d }: { k: string; d: string }): React.JSX.Element {
  return (
    <Text>
      <Text color="cyan" bold>{k}</Text>
      <Text dimColor> {d}</Text>
    </Text>
  );
}

function ItemLine({
  item,
  isCursor,
  isSelected,
  maxSize,
  status,
  spinner,
  error,
  width,
}: {
  item: CleanItem;
  isCursor: boolean;
  isSelected: boolean;
  maxSize: number;
  status: RowStatus;
  spinner: string;
  error?: string;
  width: number;
}): React.JSX.Element {
  const meta = KIND_META[item.kind];
  const name = fit(meta.label, 19);
  const size = formatBytes(item.size).padStart(8);
  const files = `${item.files}f`;
  const age = formatAge(item.mtimeMs).padStart(4);

  if (status === 'deleted') {
    return (
      <Text color="green" dimColor strikethrough>
        {fit(
          `   ✓ ${meta.icon} ${meta.label}  deleted · freed ${formatBytes(item.size)}`,
          width,
        )}
      </Text>
    );
  }

  if (status === 'failed') {
    return (
      <Text color="yellow" wrap="truncate">
        {fit(`   ✗ ${meta.icon} ${meta.label}  ${error ?? 'failed'}`, width)}
      </Text>
    );
  }

  if (status === 'cleaning') {
    return (
      <Text color="cyan">
        {fit(` ${spinner}   ${meta.icon} ${meta.label}  removing…`, width)}
      </Text>
    );
  }

  const pointer = isCursor ? '❯' : ' ';
  const checkbox = isSelected ? '◉' : '◯';
  const bar = gauge(item.size, maxSize);

  if (isCursor) {
    const line = fit(
      ` ${pointer} ${checkbox} ${meta.icon} ${name} ${bar} ${size}  ${files.padEnd(6)} ${age}`,
      width,
    );
    return (
      <Text backgroundColor="cyan" color="black" bold>
        {line}
      </Text>
    );
  }

  return (
    <Text wrap="truncate">
      {` ${pointer} `}
      <Text color={isSelected ? 'green' : 'gray'}>{checkbox}</Text>
      {' '}
      <Text color={meta.color}>{meta.icon}</Text>
      {' '}
      <Text color={isSelected ? 'white' : undefined}>{name}</Text>
      {' '}
      <Text color={meta.color} dimColor={!isSelected}>{bar}</Text>
      {' '}
      <Text color="cyan">{size}</Text>
      <Text dimColor>  {files.padEnd(6)} </Text>
      <Text dimColor>{age}</Text>
    </Text>
  );
}
