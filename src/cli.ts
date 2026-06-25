/**
 * CLI entry point for tfcleaner. Defines commands with commander and wires up
 * the scanner, cleaner and interactive UI.
 */
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from './config.js';
import { scan, groupByProject, totalSize } from './scanner.js';
import { clean } from './cleaner.js';
import { formatBytes, formatAge } from './size.js';
import { App } from './ui.js';
import type { CleanItem } from './types.js';

const VERSION = '1.0.0';

interface CommonOpts {
  path?: string[];
  includeLockFiles?: boolean;
  minSize?: string;
}

const DEFAULT_MIN_SIZE_MB = 1;

/** Parse the --min-size value (in MB) to bytes. Defaults to 1 MB. */
function minSizeBytes(opts: CommonOpts): number {
  const mb = opts.minSize === undefined ? DEFAULT_MIN_SIZE_MB : Number(opts.minSize);
  if (!Number.isFinite(mb) || mb < 0) return DEFAULT_MIN_SIZE_MB * 1024 * 1024;
  return Math.round(mb * 1024 * 1024);
}

const KIND_LABEL: Record<string, string> = {
  'terragrunt-cache': '.terragrunt-cache',
  terraform: '.terraform',
  'lock-file': '.terraform.lock.hcl',
};

/** Print a grouped, human-friendly listing of found items. */
function printFindings(items: CleanItem[]): void {
  if (items.length === 0) {
    console.log(chalk.green('Nothing to clean. You’re all tidy! ✨'));
    return;
  }
  console.log(chalk.bold('Found:'));
  console.log('');
  const groups = groupByProject(items);
  for (const group of groups) {
    console.log(chalk.blue(group.path));
    for (const item of group.items) {
      const label = (KIND_LABEL[item.kind] ?? item.name).padEnd(22);
      console.log(
        `  ${label} ${chalk.cyan(formatBytes(item.size).padStart(9))}  ${chalk.dim(
          `${item.files} files`,
        )}  ${chalk.dim(`updated ${formatAge(item.mtimeMs)}`)}`,
      );
    }
    console.log('');
  }
  console.log(chalk.bold('Total reclaimable:'));
  console.log(chalk.green(chalk.bold(formatBytes(totalSize(items)))));
}

/** Resolve config + run a scan with a spinner. */
async function doScan(opts: CommonOpts): Promise<CleanItem[]> {
  const config = await loadConfig(opts.path);
  const spinner = ora({
    text: `Scanning ${config.paths.length} path(s)…`,
    isEnabled: process.stdout.isTTY,
  }).start();
  try {
    const items = await scan(config, {
      includeLockFiles: opts.includeLockFiles,
      minSize: minSizeBytes(opts),
    });
    spinner.stop();
    return items;
  } catch (err) {
    spinner.fail('Scan failed');
    throw err;
  }
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('tfcleaner')
    .description(
      'Find and safely clean Terraform/Terragrunt generated files to reclaim disk space.',
    )
    .version(VERSION, '-v, --version')
    .option(
      '-p, --path <dir...>',
      'directories to scan (repeatable; overrides config)',
    )
    .option(
      '--include-lock-files',
      'also target .terraform.lock.hcl files',
      false,
    )
    .option(
      '--min-size <mb>',
      'hide items smaller than this many MB (use 0 to show all)',
      String(DEFAULT_MIN_SIZE_MB),
    );

  // Default action (no subcommand) => interactive TUI.
  program.action((opts: CommonOpts) => {
    const globals = program.opts<CommonOpts>();
    const merged = { ...globals, ...opts };
    runInteractive(merged);
  });

  program
    .command('scan')
    .description('scan and list reclaimable items without deleting')
    .action(async () => {
      const opts = program.opts<CommonOpts>();
      const items = await doScan(opts);
      printFindings(items);
    });

  program
    .command('clean')
    .description('delete reclaimable items')
    .option('--all', 'clean every item found (non-interactive)', false)
    .option('--dry-run', 'show what would be removed without deleting', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(
      async (cmdOpts: { all?: boolean; dryRun?: boolean; yes?: boolean }) => {
        const opts = program.opts<CommonOpts>();
        await runClean(opts, cmdOpts);
      },
    );

  return program;
}

function runInteractive(opts: CommonOpts): void {
  loadConfig(opts.path)
    .then((config) => {
      const { waitUntilExit } = render(
        React.createElement(App, {
          config,
          includeLockFiles: Boolean(opts.includeLockFiles),
          minSize: minSizeBytes(opts),
        }),
      );
      return waitUntilExit();
    })
    .catch((err) => {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    });
}

async function runClean(
  opts: CommonOpts,
  cmdOpts: { all?: boolean; dryRun?: boolean; yes?: boolean },
): Promise<void> {
  const items = await doScan(opts);

  if (items.length === 0) {
    console.log(chalk.green('Nothing to clean. You’re all tidy! ✨'));
    return;
  }

  // Without --all we still need a selection; in a non-interactive clean we
  // default to everything found but require confirmation (or --yes).
  const targets = items;

  if (cmdOpts.dryRun) {
    console.log(chalk.yellow('Dry run — nothing will be deleted.'));
    console.log('');
    printFindings(targets);
    console.log('');
    console.log(
      chalk.dim(
        `Would remove ${targets.length} item(s), freeing ${formatBytes(
          totalSize(targets),
        )}.`,
      ),
    );
    return;
  }

  if (!cmdOpts.all) {
    console.log(
      chalk.dim(
        'Tip: run `tfcleaner` (no args) for interactive selection, or pass --all.',
      ),
    );
  }

  // Confirmation.
  console.log(chalk.yellow.bold('You are about to delete:'));
  console.log('');
  for (const item of targets.slice(0, 20)) {
    console.log(
      `  ${chalk.green('✓')} ${KIND_LABEL[item.kind] ?? item.name} ${chalk.dim(
        item.path,
      )} ${chalk.cyan(formatBytes(item.size))}`,
    );
  }
  if (targets.length > 20) {
    console.log(chalk.dim(`  …and ${targets.length - 20} more`));
  }
  console.log('');
  console.log(
    `Total: ${chalk.bold(formatBytes(totalSize(targets)))} across ${
      targets.length
    } item(s)`,
  );
  console.log('');

  if (!cmdOpts.yes) {
    const ok = await confirm('Continue? y/N ');
    if (!ok) {
      console.log(chalk.dim('Aborted.'));
      return;
    }
  }

  const spinner = ora({
    text: 'Cleaning…',
    isEnabled: process.stdout.isTTY,
  }).start();

  const summary = await clean(targets, {
    onProgress: (res, index, total) => {
      spinner.text = `Cleaning… ${index + 1}/${total}  ${res.item.path}`;
    },
  });

  spinner.stop();

  console.log(chalk.green.bold('Cleanup completed'));
  console.log('');
  console.log(
    `Removed: ${chalk.bold(String(summary.removedItems))} items (${
      summary.removedFiles
    } files)`,
  );
  console.log(`Recovered: ${chalk.bold(formatBytes(summary.freedBytes))}`);
  if (summary.failures.length > 0) {
    console.log(chalk.yellow(`Failed: ${summary.failures.length} item(s)`));
    for (const f of summary.failures) {
      console.log(chalk.dim(`  ${f.item.path}: ${f.error}`));
    }
  }
  console.log(`Time: ${(summary.durationMs / 1000).toFixed(1)}s`);
}

/** Minimal y/N prompt on stdin without extra dependencies. */
function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // No TTY: be safe and decline.
      resolve(false);
      return;
    }
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (data: string) => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      const answer = data.trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    };
    process.stdin.on('data', onData);
  });
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
