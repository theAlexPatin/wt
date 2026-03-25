#!/bin/zsh
# wt ls — list all worktrees

if [ ! -d "$WT_ROOT" ] || [ -z "$(ls -A "$WT_ROOT" 2>/dev/null)" ]; then
  echo "No worktrees found."
  return 0
fi

local detected_repo="" detected_wt=""
__wt_detect_context
local filter_repo="$detected_repo"
[ -n "$filter_repo" ] && [ ! -d "$WT_ROOT/$filter_repo" ] && filter_repo=""

local found=false
for repo_dir in "$WT_ROOT"/*/; do
  [ -d "$repo_dir" ] || continue
  local repo="$(basename "$repo_dir")"
  [ -n "$filter_repo" ] && [ "$repo" != "$filter_repo" ] && continue
  for wt_dir in "$repo_dir"*/; do
    [ -d "$wt_dir" ] || continue
    echo "$repo/$(basename "$wt_dir")"
    found=true
  done
done

if [ "$found" = false ]; then
  echo "No worktrees found."
fi
