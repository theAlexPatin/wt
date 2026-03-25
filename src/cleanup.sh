#!/bin/zsh
# wt cleanup [repo/worktree | worktree] — remove worktrees

__wt_remove() {
  local wt_path="$1"
  local real_path="$wt_path"
  [ -L "$wt_path" ] && { real_path="$(readlink "$wt_path")"; rm "$wt_path"; }

  local branch=""
  [ -d "$real_path" ] && branch="$(git -C "$real_path" rev-parse --abbrev-ref HEAD 2>/dev/null)"

  local rr=""
  if [ -f "$real_path/.git" ]; then
    rr="$(git -C "$real_path" worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')"
  fi

  local removed=false
  if [ -n "$rr" ] && [ -d "$rr" ]; then
    git -C "$rr" worktree remove "$real_path" --force 2>/dev/null && removed=true
  fi
  [ "$removed" = false ] && [ -d "$real_path" ] && rm -rf "$real_path"
  [ -n "$rr" ] && [ -d "$rr" ] && git -C "$rr" worktree prune 2>/dev/null

  if [ -n "$rr" ] && [ -d "$rr" ] && [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    git -C "$rr" branch -D "$branch" 2>/dev/null
  fi
}

__wt_cleanup_single() {
  local r="$1" wt="$2"
  local wt_path="$WT_ROOT/$r/$wt"
  local repo_root=""
  __wt_resolve_repo_root "$wt_path"

  __wt_remove "$wt_path"
  echo "  Removed $r/$wt"

  if [ -d "$WT_ROOT/$r" ] && [ -z "$(ls -A "$WT_ROOT/$r" 2>/dev/null)" ]; then
    rmdir "$WT_ROOT/$r"
    echo "  Cleaned up empty $r/"
  fi

  local cwd="$(pwd)"
  if [[ "$cwd" == "$wt_path"* ]]; then
    if [ -n "$repo_root" ] && [ -d "$repo_root" ]; then
      cd "$repo_root"
    else
      cd "$WT_ROOT"
    fi
  fi
}

if [ ! -d "$WT_ROOT" ] || [ -z "$(ls -A "$WT_ROOT" 2>/dev/null)" ]; then
  echo "No worktrees found in $WT_ROOT"
  unfunction __wt_remove __wt_cleanup_single 2>/dev/null
  return 0
fi

local detected_repo="" detected_wt="" repo="" selected_wt=""

if [ -n "$1" ]; then
  __wt_resolve_arg "$1" || { unfunction __wt_remove __wt_cleanup_single 2>/dev/null; return 1; }
  __wt_cleanup_single "$repo" "$selected_wt"
  unfunction __wt_remove __wt_cleanup_single 2>/dev/null
  return 0
fi

__wt_detect_context

if [ -n "$detected_wt" ] && [ -d "$WT_ROOT/$detected_repo/$detected_wt" ]; then
  __wt_cleanup_single "$detected_repo" "$detected_wt"
  unfunction __wt_remove __wt_cleanup_single 2>/dev/null
  return 0
fi

__wt_pick_repo "Select repo to clean up"
local rc=$?
if [ $rc -ne 0 ]; then
  [ $rc -eq 1 ] && echo "No worktree repos remaining."
  unfunction __wt_remove __wt_cleanup_single 2>/dev/null
  return 0
fi

while true; do
  detected_wt=""
  __wt_pick_worktree "Select worktree to remove ($repo)"
  rc=$?
  if [ $rc -eq 1 ]; then
    echo "No worktrees remaining for $repo"
    rmdir "$WT_ROOT/$repo" 2>/dev/null
    break
  fi
  [ $rc -eq 2 ] && break

  __wt_remove "$WT_ROOT/$repo/$selected_wt"
  echo "  Removed $repo/$selected_wt"

  if [ -d "$WT_ROOT/$repo" ] && [ -z "$(ls -A "$WT_ROOT/$repo" 2>/dev/null)" ]; then
    rmdir "$WT_ROOT/$repo"
    echo "  Cleaned up empty $repo/"
    break
  fi
done

unfunction __wt_remove __wt_cleanup_single 2>/dev/null
