#!/bin/zsh
# wt config — interactive configuration for global and repo settings

__wt_prompt_input() {
  local label="$1"
  local current_value="$2"
  local response=""

  if [ -t 0 ] && [ -t 1 ] && command -v gum >/dev/null 2>&1; then
    response="$(gum input --header "$label" --value "$current_value")"
  else
    printf '%s [%s]: ' "$label" "$current_value" >&2
    IFS= read -r response
  fi

  [ -z "$response" ] && response="$current_value"
  print -r -- "$response"
}

echo "wt configuration"
echo ""

local current_root="${WT_ROOT:-$HOME/.worktrees}"
local desired_root=""
desired_root="$(__wt_prompt_input "Default worktrees location" "$current_root")"

if [ -n "$desired_root" ]; then
  local normalized_root=""
  normalized_root="$(__wt_normalize_dir_path "$desired_root")"

  if [ "$normalized_root" != "$current_root" ]; then
    __wt_set_default_worktrees_root "$normalized_root" || {
      echo "Failed to save default worktrees location"
      unfunction __wt_prompt_input 2>/dev/null
      return 1
    }
    WT_ROOT="$normalized_root"
    echo "Saved default worktrees location: $WT_ROOT"
  else
    echo "Default worktrees location unchanged: $WT_ROOT"
  fi
fi

local git_root=""
git_root="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ -n "$git_root" ]; then
  local current_dir="$(pwd -P)"
  local worktree_root="$(cd "$git_root" && pwd -P)"

  if [ "$current_dir" = "$worktree_root" ]; then
    local current_setup_script=""
    current_setup_script="$(__wt_get_repo_setup_script "$git_root")"

    local desired_setup_script=""
    desired_setup_script="$(__wt_prompt_input "Setup script name for this repository" "$current_setup_script")"

    if [ -n "$desired_setup_script" ]; then
      if [ "$desired_setup_script" != "$current_setup_script" ]; then
        __wt_set_repo_setup_script "$desired_setup_script" "$git_root" || {
          echo "Failed to save setup script name"
          unfunction __wt_prompt_input 2>/dev/null
          return 1
        }
        echo "Saved setup script name for $(basename "$git_root"): $desired_setup_script"
      else
        echo "Setup script name unchanged: $current_setup_script"
      fi
    fi
  else
    echo "Repo setup script is configurable from the worktree root directory."
  fi
fi

unfunction __wt_prompt_input 2>/dev/null
