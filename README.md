# tfcleaner

Find and **safely** clean Terraform/Terragrunt generated files and reclaim disk space.

Terraform and Terragrunt scatter heavy generated folders across every project —
`.terraform` and `.terragrunt-cache`. Over time these can eat tens of gigabytes.
`tfcleaner` scans your machine, shows you exactly how much each one is costing you,
and lets you wipe them with a keystroke — without ever touching your `.tf` source,
`.tfvars`, state files, or `.terraform.lock.hcl` lock files.

## Install

```bash
npm i -g tfcleaner
```

Then just run:

```bash
tfcleaner
```

and the interactive UI opens.

> Prefer not to install? Run it on demand with `npx tfcleaner` — no global install required.

## Quick start

```bash
# Interactive TUI (lazygit / ncdu style)
tfcleaner

# Just list what's reclaimable
tfcleaner scan

# Delete everything found (asks for confirmation)
tfcleaner clean --all

# See what would be removed, change nothing
tfcleaner clean --dry-run
```

## Screenshot

```
Terraform Cleaner
Reclaimable: 12.8 GB   Selected: 2 item(s) 6.3 GB

/Users/me/projects/payment-api
 ❯ ◉ ◆ .terragrunt-cache   ████████████   4.2 GB  15234f  2d
   ◯ ▲ .terraform          ██··········   600 MB  812f    3mo

/Users/me/projects/auth-service
   ◉ ◆ .terragrunt-cache   ██████······   2.1 GB  9001f   5mo

↑↓ move · g/G ends · space pick · a all · c clean · q quit
```
## Commands

| Command | Description |
| --- | --- |
| `tfcleaner` | Launch the interactive terminal UI. |
| `tfcleaner scan` | List reclaimable items grouped by project, with sizes. Deletes nothing. |
| `tfcleaner clean --all` | Delete every item found (confirmation required). |
| `tfcleaner clean --dry-run` | Print what would be removed; change nothing. |

### Global options

| Option | Description |
| --- | --- |
| `-p, --path <dir...>` | One or more directories to scan (overrides config). |
| `--min-size <mb>` | Hide items smaller than this many MB. Defaults to `1`; use `0` to show everything. |
| `-v, --version` | Print version. |

### `clean` options

| Option | Description |
| --- | --- |
| `--all` | Clean every item found. |
| `--dry-run` | Show what would be removed without deleting. |
| `-y, --yes` | Skip the confirmation prompt. |

## Interactive controls

| Key | Action |
| --- | --- |
| `↑` / `↓` (or `k` / `j`) | Navigate |
| `g` / `G` (or PageUp / PageDown) | Jump to first / last item |
| `space` | Select / deselect item |
| `a` | Select all / none |
| `c` | Clean selected — press once to arm (shows a warning), press `c` again to confirm. Deletes in place and marks rows as deleted. Any other key cancels. |
| `q` | Quit |

## What it finds

By default `tfcleaner` scans your **current directory** and **home directory** for:

- `.terragrunt-cache` directories
- `.terraform` directories

It skips `.git`, `node_modules`, `vendor`, `dist`, and `build` while scanning.
Lock files (`.terraform.lock.hcl`) are intentionally never scanned or deleted.

## Configuration

Create a `~/.tfcleanerrc` (JSON) to customize scan paths and ignore rules:

```json
{
  "paths": ["~/projects", "~/workspace"],
  "ignore": [".git", "node_modules", "vendor", "dist", "build"]
}
```

`~` is expanded to your home directory. CLI `--path` flags override the config file.

## Safety

`tfcleaner` is conservative by design. It will **only** ever delete these two
generated directories:

- `.terragrunt-cache` directories
- `.terraform` directories

It will **never** delete any file, including:

- `.terraform.lock.hcl` lock files
- `*.tf` source files
- `*.tfvars` variable files
- `terraform.tfstate`
- `terraform.tfstate.backup`

Every deletion passes through a final safety guard (`assertSafe`) that rejects
**any file** and any directory outside the two allowed names, regardless of how it
was selected. Symlinks are counted but never followed, so a link can't trick the
tool into deleting a target. If one item fails (permission denied, broken symlink,
vanished folder), the rest still get cleaned and the failure is reported at the end.

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # build + run the test suite
npm start          # run the built CLI
```

Project layout:

```
src/
  cli.ts        # commander commands (scan / clean / interactive)
  scanner.ts    # find + group reclaimable items
  cleaner.ts    # safe deletion with guards
  size.ts       # recursive size + file count, byte formatting
  config.ts     # ~/.tfcleanerrc loading, defaults, ~ expansion
  ui.tsx        # Ink interactive TUI
  types.ts      # shared types
bin/
  tfcleaner.js  # executable launcher
test/           # node:test suite
```

## Requirements

Node.js >= 20.

## License

MIT
