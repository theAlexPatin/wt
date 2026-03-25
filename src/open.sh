#!/bin/zsh
# wt cd [repo/worktree | worktree] — cd into a worktree

if [ ! -d "$WT_ROOT" ] || [ -z "$(ls -A "$WT_ROOT" 2>/dev/null)" ]; then
  echo "No worktrees found in $WT_ROOT"
  return 0
fi

local detected_repo="" detected_wt="" repo="" selected_wt=""

if [ -n "$1" ]; then
  __wt_resolve_arg "$1" || return 1
  cd "$WT_ROOT/$repo/$selected_wt"
  return 0
fi

# Interactive mode
__wt_detect_context
__wt_pick_repo "Select repo" || { [ $? -eq 1 ] && echo "No worktrees found in $WT_ROOT"; return 0; }

detected_wt=""
__wt_pick_worktree "Select worktree ($repo)" || { [ $? -eq 1 ] && echo "No worktrees found for $repo"; return 0; }

cd "$WT_ROOT/$repo/$selected_wt"
