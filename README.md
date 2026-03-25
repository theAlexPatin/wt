# wt

A fast, ergonomic CLI for managing [git worktrees](https://git-scm.com/docs/git-worktree).

Git worktrees let you check out multiple branches simultaneously in separate directories — no more stashing, no more context-switching pain. **wt** makes them frictionless: create, navigate, rename, and clean up worktrees with short commands and interactive pickers.

<p align="center">
  <img src="demo.gif" alt="wt demo" width="800" />
</p>

<br>

## Why

Git worktrees are powerful but tedious to manage by hand. You end up with long `git worktree add` invocations, forget where you put things, and accumulate stale directories.

**wt** fixes this by:

- Keeping all worktrees in one place (`~/.worktrees/<repo>/<branch>`)
- Auto-detecting context from your cwd — no need to specify the repo
- Matching branch names to worktree names automatically
- Running your project's setup script on creation (symlink caches, copy `.env` files)
- Providing interactive pickers with graceful fallback: [gum](https://github.com/charmbracelet/gum) when installed, numbered prompts otherwise

<br>

## Install

**Requirements:** zsh, git 2.17+. Optional: [gum](https://github.com/charmbracelet/gum) for enhanced interactive pickers.

```sh
npm install -g @nitap/wt
wt-setup
```

Or with yarn:

```sh
yarn global add @nitap/wt
wt-setup
```

Then restart your shell (or `source ~/.zshrc`).

`wt-setup` adds a shell function to your `.zshrc` that sources the installed files — this is needed because `wt` uses `cd` to change your working directory, which only works from a sourced function.

<details>
<summary><strong>Install from source</strong></summary>

```sh
git clone https://github.com/thealexpatin/wt.git
cd wt
bash install.sh
```

This copies the source files to `~/.wt` and adds the shell function to your `.zshrc`.

</details>

<details>
<summary><strong>Manual install</strong></summary>

Copy the `src/` directory wherever you like and add this to your `.zshrc`:

```sh
wt() { source "/path/to/wt/src/main.sh" "$@" }
```

</details>

<details>
<summary><strong>Uninstall</strong></summary>

```sh
npm uninstall -g @nitap/wt
```

Then remove the `wt()` function from your `.zshrc`. Your worktrees in `~/.worktrees` are left untouched.

</details>

<br>

## Commands

### `wt new [name]`

Create a worktree and cd into it. Omit the name to auto-generate one (`wt-<id>`). Creates a git branch with the same name.

```sh
wt new my-feature       # creates ~/.worktrees/myrepo/my-feature
wt new                  # creates ~/.worktrees/myrepo/wt-a3f8b2c1
```

If a configured setup script exists in the repo root (`.worktree-setup` by default), it runs automatically — symlinking build caches, copying `.env` files, and getting you ready to work immediately.

### `wt cd [target]`

Jump to a worktree. Pass a name directly, or omit it for an interactive picker.

```sh
wt cd my-feature        # direct jump (infers repo from cwd)
wt cd myrepo/my-feature # fully qualified
wt cd                   # interactive picker
```

### `wt ls`

List worktrees. Scoped to the current repo when run from inside a repo or worktree.

```sh
$ wt ls
myrepo/my-feature
myrepo/bugfix-123
myrepo/wt-a3f8b2c1
```

### `wt rename [old] [new]`

Rename a worktree **and** its git branch in one step.

```sh
wt rename my-feature auth-refactor   # rename across repos
wt rename auth-refactor              # rename current worktree (from inside it)
wt rename                            # interactive: pick worktree, type new name
```

### `wt cleanup [target]`

Remove a worktree and delete its local branch.

```sh
wt cleanup my-feature        # remove specific worktree
wt cleanup                   # from inside a worktree: removes it, cds to repo root
                              # otherwise: interactive multi-remove loop
```

### `wt setup`

Generate the configured setup script for the current repo (`.worktree-setup` by default). This script runs automatically when anyone creates a worktree with `wt new`. The default template:

- Symlinks build caches (`.turbo`, `.next`, `vendor`, `Pods`, etc.)
- Copies `.env` and `.env.*` files
- Symlinks `.yarn/cache`

Customize it for your project. It's automatically added to `.git/info/exclude` so it won't clutter your git status.

### `wt config`

Interactive configuration for global and repo settings:

- Set the default worktrees location (saved globally)
- Set a custom setup script name for the current repository (when run from a worktree root)

```sh
wt config
```

### `wt root`

Navigate back to the main repo checkout from inside a worktree.

```sh
~/.worktrees/myrepo/my-feature $ wt root
~/code/myrepo $
```

<br>

## How it works

```
~/.worktrees/
  myrepo/
    my-feature/     -> git worktree (branch: my-feature)
    bugfix-123/     -> git worktree (branch: bugfix-123)
  other-repo/
    experiment/     -> git worktree (branch: experiment)
```

**wt** stores all worktrees under `~/.worktrees/<repo-name>/<worktree-name>`. Each worktree gets a git branch with the same name. The CLI auto-detects which repo you're working in from your cwd, so most commands need zero arguments.

<br>

## Configuration

Use `wt config` for guided setup:

```sh
wt config
```

On first use, any command that needs worktrees (`wt new`, `wt ls`, `wt cd`, etc.) prompts for a default worktrees location if `~/.wt/config.json` has no `worktreesRoot` yet.

This writes:

- Global defaults to `~/.wt/config.json` (or `WT_CONFIG_FILE`)
- Per-project config to `<repo-root>/.wt.config.json`

Environment variables still work and take priority:

| Variable | Default | Description |
|---|---|---|
| `WT_ROOT` | `~/.worktrees` | Base directory where worktrees are stored (overrides config file) |
| `WT_CONFIG_FILE` | `~/.wt/config.json` | Global config file location |
| `WT_INSTALL_DIR` | `~/.wt` | Where the wt source files live |

```sh
# Example: store worktrees under ~/trees instead
export WT_ROOT="$HOME/trees"
```

<br>

## AI agent integration

**wt** pairs well with AI coding agents that work on parallel tasks. Each agent gets its own isolated worktree — its own branch, working directory, and build caches — with zero conflicts.

```sh
# agent 1: working on auth
wt new auth-refactor

# agent 2: working on tests (separate worktree, separate branch)
wt new fix-flaky-tests

# both compile independently, no stash/checkout dance
```

The `.worktree-setup` script means each worktree is ready to build immediately — agents don't waste time installing dependencies from scratch.

<br>

## Re-recording the demo

The hero GIF is generated from `demo.tape` using [vhs](https://github.com/charmbracelet/vhs):

```sh
vhs demo.tape
```

<br>

## License

[MIT](LICENSE)
