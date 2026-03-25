#!/bin/zsh
# wt root — navigate to the source repo for the current worktree

local cwd="$(pwd)"

if [[ "$cwd" != "$WT_ROOT"/* ]]; then
  echo "Not in a worktree directory"
  return 0
fi

local rel="${cwd#$WT_ROOT/}"
local repo="${rel%%/*}"
local wt_name="${rel#*/}"
wt_name="${wt_name%%/*}"

local repo_root=""
__wt_resolve_repo_root "$WT_ROOT/$repo/$wt_name"

if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
  echo "Could not resolve source repo for $repo/$wt_name"
  return 1
fi

cd "$repo_root"
