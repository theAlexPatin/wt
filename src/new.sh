#!/bin/zsh
# wt new [name] — create a new worktree and cd into it

local name="$1"
if [ -z "$name" ]; then
  name="wt-$(head -c 4 /dev/urandom | xxd -p)"
fi

local repo_root=""
local repo=""
local detected_repo="" detected_wt=""

__wt_detect_context

if [ -n "$detected_repo" ] && [[ "$(pwd)" == "$WT_ROOT"/* ]]; then
  repo="$detected_repo"
  local current_wt_path="$WT_ROOT/$detected_repo/$detected_wt"
  __wt_resolve_repo_root "$current_wt_path"
  if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
    echo "Could not resolve source repo for $detected_repo/$detected_wt"
    return 1
  fi
elif git rev-parse --show-toplevel &>/dev/null; then
  repo_root="$(git rev-parse --show-toplevel)"
  repo="$(basename "$repo_root")"
else
  __wt_pick_repo "Select repo for new worktree"
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "Not in a git repository and no existing worktree repos found."
    return 1
  fi

  local sample_wt=""
  for d in "$WT_ROOT/$repo"/*/; do
    [ -d "$d" ] && { sample_wt="$d"; break; }
  done

  if [ -z "$sample_wt" ]; then
    echo "No worktrees found for $repo to resolve source repo."
    return 1
  fi

  __wt_resolve_repo_root "$sample_wt"

  if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
    echo "Could not resolve source repo for $repo"
    return 1
  fi
fi

local repo_wt_dir="$WT_ROOT/$repo"
local wt_path="$repo_wt_dir/$name"

if [ -d "$wt_path" ] || [ -L "$wt_path" ]; then
  echo "Worktree already exists: $wt_path"
  return 1
fi

mkdir -p "$repo_wt_dir"
git -C "$repo_root" worktree add "$wt_path" -b "$name" || return 1

cd "$wt_path"

local setup_script_name=""
local setup_script_path=""
setup_script_name="$(__wt_get_repo_setup_script "$repo_root")"
setup_script_path="$repo_root/$setup_script_name"

if [ -f "$setup_script_path" ]; then
  echo "Running $setup_script_name..."
  source "$setup_script_path" "$repo_root"
fi
