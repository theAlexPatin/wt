#!/bin/zsh
# wt rename [old-name] [new-name] — rename a worktree and its branch
# 0-arg: interactive (auto-detects repo/worktree from cwd)
# 1-arg from inside worktree: rename current worktree to given name
# 2-arg: rename old-name to new-name (searches across repos)

local old_name="$1"
local new_name="$2"
local repo="" wt_path=""

if [ -n "$old_name" ] && [ -n "$new_name" ]; then
  local matches=()
  for repo_dir in "$WT_ROOT"/*/; do
    [ -d "$repo_dir" ] || continue
    [ -d "$repo_dir$old_name" ] && matches+=("$(basename "$repo_dir")")
  done

  if [ ${#matches[@]} -eq 0 ]; then
    echo "Worktree '$old_name' not found."
    return 1
  elif [ ${#matches[@]} -gt 1 ]; then
    echo "Ambiguous: '$old_name' exists in multiple repos: ${matches[*]}"
    echo "Use interactive mode: wt rename"
    return 1
  fi

  repo="${matches[1]}"
  wt_path="$WT_ROOT/$repo/$old_name"
else
  [ -n "$old_name" ] && new_name="$old_name"

  local detected_repo="" detected_wt="" selected_wt=""
  __wt_detect_context
  __wt_pick_repo "Select repo" || { [ $? -eq 1 ] && echo "No worktrees found."; return 0; }

  if [ -n "$new_name" ]; then
    if [ -z "$detected_wt" ]; then
      echo "Not inside a worktree. Use: wt rename <old> <new>"
      return 1
    fi
    old_name="$detected_wt"
  else
    __wt_pick_worktree "Select worktree to rename ($repo)"
    local rc=$?
    [ $rc -eq 1 ] && { echo "No worktrees found for $repo"; return 0; }
    [ $rc -eq 2 ] && return 0
    old_name="$selected_wt"
  fi

  wt_path="$WT_ROOT/$repo/$old_name"

  if [ -z "$new_name" ]; then
    new_name=$(gum input --header "New name" --placeholder "$old_name")
    [ -z "$new_name" ] && return 0
    [ "$new_name" = "$old_name" ] && { echo "Name unchanged."; return 0; }
  fi
fi

local new_wt_path="$WT_ROOT/$repo/$new_name"

if [ -d "$new_wt_path" ] || [ -L "$new_wt_path" ]; then
  echo "Worktree '$new_name' already exists in $repo."
  return 1
fi

local real_path="$wt_path"
[ -L "$wt_path" ] && real_path="$(readlink "$wt_path")"

local repo_root=""
__wt_resolve_repo_root "$wt_path"

if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
  echo "Could not resolve source repo for $repo/$old_name"
  return 1
fi

local old_branch
old_branch="$(git -C "$real_path" rev-parse --abbrev-ref HEAD 2>/dev/null)"

if [ -n "$old_branch" ] && [ "$old_branch" != "HEAD" ]; then
  git -C "$repo_root" branch -m "$old_branch" "$new_name" || {
    echo "Failed to rename branch '$old_branch' to '$new_name'"
    return 1
  }
  echo "  Branch: $old_branch -> $new_name"
fi

git -C "$repo_root" worktree move "$real_path" "$new_wt_path" || {
  echo "Failed to move worktree"
  return 1
}

[ -L "$wt_path" ] && rm "$wt_path"

echo "  Worktree: $repo/$old_name -> $repo/$new_name"

local cwd="$(pwd)"
if [[ "$cwd" == "$real_path"* ]]; then
  cd "${cwd/$real_path/$new_wt_path}"
fi
