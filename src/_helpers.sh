#!/bin/zsh
# Shared helpers for wt CLI. Sourced by main.sh, cleaned up after dispatch.
# Helpers set variables in the caller's scope — do NOT use `local` on output vars.

WT_CONFIG_FILE="${WT_CONFIG_FILE:-$HOME/.wt/config.json}"

__wt_normalize_dir_path() {
  local path="$1"
  [[ "$path" == "~"* ]] && path="${path/#\~/$HOME}"
  [[ "$path" != /* ]] && path="$(pwd)/$path"
  [ "$path" != "/" ] && path="${path%/}"
  print -r -- "$path"
}

__wt_json_get_string() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$file" "$key" <<'PY'
import json
import sys

path, key = sys.argv[1], sys.argv[2]

try:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    sys.exit(1)

value = data.get(key)
if isinstance(value, str):
    print(value)
    sys.exit(0)

sys.exit(1)
PY
    return $?
  fi

  local parsed_value=""
  parsed_value="$(sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1)"
  [ -n "$parsed_value" ] || return 1
  print -r -- "$parsed_value"
}

__wt_json_set_string() {
  local file="$1"
  local key="$2"
  local value="$3"

  mkdir -p "$(dirname "$file")" || return 1

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$file" "$key" "$value" <<'PY'
import json
import os
import sys

path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}

if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
            if isinstance(existing, dict):
                data = existing
    except Exception:
        pass

data[key] = value
os.makedirs(os.path.dirname(path), exist_ok=True)

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, sort_keys=True)
    f.write('\n')
PY
    return $?
  fi

  local escaped_value="$value"
  escaped_value="${escaped_value//\\/\\\\}"
  escaped_value="${escaped_value//\"/\\\"}"
  printf '{\n  "%s": "%s"\n}\n' "$key" "$escaped_value" > "$file"
}

__wt_global_config_file() {
  print -r -- "$WT_CONFIG_FILE"
}

__wt_get_default_worktrees_root() {
  local configured_root=""
  configured_root="$(__wt_json_get_string "$(__wt_global_config_file)" "worktreesRoot")"
  [ -n "$configured_root" ] || return 1
  [[ "$configured_root" == "~"* ]] && configured_root="${configured_root/#\~/$HOME}"
  print -r -- "$configured_root"
}

__wt_set_default_worktrees_root() {
  local worktrees_root="$1"
  __wt_json_set_string "$(__wt_global_config_file)" "worktreesRoot" "$worktrees_root"
}

__wt_ensure_initialized() {
  [ -n "${WT_ROOT:-}" ] && return 0

  local default_root="$HOME/.worktrees"
  local chosen_root=""

  echo "wt is not initialized yet."

  if [ -t 0 ] && [ -t 1 ] && command -v gum >/dev/null 2>&1; then
    chosen_root="$(gum input --header "Default worktrees location" --value "$default_root")"
  elif [ -t 0 ]; then
    printf 'Default worktrees location [%s]: ' "$default_root" >&2
    IFS= read -r chosen_root
  else
    echo "Set your default worktrees location with 'wt config' in an interactive shell."
    return 1
  fi

  [ -z "$chosen_root" ] && chosen_root="$default_root"
  chosen_root="$(__wt_normalize_dir_path "$chosen_root")"

  __wt_set_default_worktrees_root "$chosen_root" || {
    echo "Failed to save default worktrees location"
    return 1
  }

  WT_ROOT="$chosen_root"
  echo "Saved default worktrees location: $WT_ROOT"
}

__wt_config_repo_root() {
  local repo_path="$1"
  local root_path=""

  if [ -n "$repo_path" ]; then
    root_path="$(git -C "$repo_path" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
    [ -z "$root_path" ] && root_path="$(git -C "$repo_path" rev-parse --show-toplevel 2>/dev/null)"
  else
    root_path="$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
    [ -z "$root_path" ] && root_path="$(git rev-parse --show-toplevel 2>/dev/null)"
  fi

  [ -n "$root_path" ] || return 1
  root_path="$(cd "$root_path" 2>/dev/null && pwd -P)" || return 1
  print -r -- "$root_path"
}

__wt_repo_config_file() {
  local repo_path="$1"
  local root_path=""

  root_path="$(__wt_config_repo_root "$repo_path")" || return 1
  print -r -- "$root_path/.wt.config.json"
}

__wt_get_repo_setup_script() {
  local repo_path="$1"
  local config_file=""
  local setup_script=""

  config_file="$(__wt_repo_config_file "$repo_path")" || {
    print -r -- ".worktree-setup"
    return 0
  }

  setup_script="$(__wt_json_get_string "$config_file" "setupScript")"
  [ -n "$setup_script" ] && print -r -- "$setup_script" || print -r -- ".worktree-setup"
}

__wt_set_repo_setup_script() {
  local setup_script="$1"
  local repo_path="$2"
  local config_file=""

  config_file="$(__wt_repo_config_file "$repo_path")" || return 1
  __wt_json_set_string "$config_file" "setupScript" "$setup_script"
}

__wt_configured_root=""
if [ -z "${WT_ROOT:-}" ]; then
  __wt_configured_root="$(__wt_get_default_worktrees_root)"
fi

WT_ROOT="${WT_ROOT:-$__wt_configured_root}"
[[ "$WT_ROOT" == "~"* ]] && WT_ROOT="${WT_ROOT/#\~/$HOME}"

unset __wt_configured_root

# Detect repo and worktree from cwd.
# Sets: detected_repo, detected_wt
__wt_detect_context() {
  local cwd="$(pwd)"
  detected_repo=""
  detected_wt=""
  if [[ "$cwd" == "$WT_ROOT"/* ]]; then
    local rel="${cwd#$WT_ROOT/}"
    detected_repo="${rel%%/*}"
    local after_repo="${rel#*/}"
    [[ "$after_repo" != "$rel" ]] && detected_wt="${after_repo%%/*}"
  else
    local git_root
    git_root="$(git rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "$git_root" ]; then
      local name="$(basename "$git_root")"
      [ -d "$WT_ROOT/$name" ] && detected_repo="$name"
    fi
  fi
}

# Choose one item from a list.
# Output: selected item on stdout
# Returns: 0=ok, 2=user cancelled or unavailable interactivity
__wt_choose_from_list() {
  local header="$1"
  shift
  local choices=("$@")
  local selected_item=""

  [ ${#choices[@]} -eq 0 ] && return 2

  if command -v gum >/dev/null 2>&1; then
    selected_item=$(printf '%s\n' "${choices[@]}" | gum choose --header "$header")
    [ -z "$selected_item" ] && return 2
    print -r -- "$selected_item"
    return 0
  fi

  [ -t 0 ] || {
    echo "Interactive selection requires a TTY (install gum for non-standard shells)." >&2
    return 2
  }

  echo "$header" >&2
  local i=1
  for item in "${choices[@]}"; do
    printf '  %d) %s\n' "$i" "$item" >&2
    ((i++))
  done

  local choice_index=""
  while true; do
    printf 'Enter choice [1-%d] (blank to cancel): ' "${#choices[@]}" >&2
    IFS= read -r choice_index || return 2
    [ -z "$choice_index" ] && return 2

    if [[ "$choice_index" != <-> ]] || (( choice_index < 1 || choice_index > ${#choices[@]} )); then
      echo "Invalid choice." >&2
      continue
    fi

    print -r -- "${choices[$choice_index]}"
    return 0
  done
}

# Pick a repo. Uses detected_repo if set, else single-select or gum picker.
# Sets: repo
# Returns: 0=ok, 1=none found, 2=user cancelled
__wt_pick_repo() {
  local header="${1:-Select repo}"
  repo=""

  if [ -n "$detected_repo" ] && [ -d "$WT_ROOT/$detected_repo" ]; then
    repo="$detected_repo"
    return 0
  fi

  if [ ! -d "$WT_ROOT" ] || [ -z "$(ls -A "$WT_ROOT" 2>/dev/null)" ]; then
    return 1
  fi

  local repos=()
  for d in "$WT_ROOT"/*/; do
    [ -d "$d" ] && repos+=("$(basename "$d")")
  done

  if [ ${#repos[@]} -eq 0 ]; then
    return 1
  elif [ ${#repos[@]} -eq 1 ]; then
    repo="${repos[1]}"
  else
    repo="$(__wt_choose_from_list "$header" "${repos[@]}")" || return $?
  fi
  return 0
}

# Pick a worktree within $repo.
# Requires: repo
# Sets: selected_wt
# Returns: 0=ok, 1=none found, 2=user cancelled
__wt_pick_worktree() {
  local header="${1:-Select worktree}"
  selected_wt=""

  if [ -n "$detected_wt" ] && [ -d "$WT_ROOT/$repo/$detected_wt" ]; then
    selected_wt="$detected_wt"
    return 0
  fi

  local worktrees=()
  for d in "$WT_ROOT/$repo"/*/; do
    [ -d "$d" ] && worktrees+=("$(basename "$d")")
  done

  if [ ${#worktrees[@]} -eq 0 ]; then
    return 1
  elif [ ${#worktrees[@]} -eq 1 ]; then
    selected_wt="${worktrees[1]}"
  else
    selected_wt="$(__wt_choose_from_list "$header" "${worktrees[@]}")" || return $?
  fi
  return 0
}

# Resolve repo + worktree from an argument like "repo/wt" or "wt".
# Returns: 0=ok, 1=not found
__wt_resolve_arg() {
  local arg="$1"
  repo=""
  selected_wt=""

  if [[ "$arg" == */* ]]; then
    repo="${arg%%/*}"
    selected_wt="${arg#*/}"
  else
    __wt_detect_context
    if [ -z "$detected_repo" ]; then
      echo "Not in a repo context. Use: <repo>/<worktree>"
      return 1
    fi
    repo="$detected_repo"
    selected_wt="$arg"
  fi

  if [ ! -d "$WT_ROOT/$repo/$selected_wt" ]; then
    echo "Worktree not found: $repo/$selected_wt"
    return 1
  fi
}

# Resolve the source repo root from a worktree path.
# Sets: repo_root
__wt_resolve_repo_root() {
  local wt_path="$1"
  repo_root=""
  local real_path="$wt_path"
  [ -L "$wt_path" ] && real_path="$(readlink "$wt_path")"
  if [ -f "$real_path/.git" ]; then
    repo_root="$(git -C "$real_path" worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')"
  fi
}

# Remove all helper functions from the shell.
__wt_cleanup_helpers() {
  unfunction __wt_normalize_dir_path __wt_json_get_string __wt_json_set_string __wt_global_config_file __wt_get_default_worktrees_root __wt_set_default_worktrees_root __wt_ensure_initialized __wt_config_repo_root __wt_repo_config_file __wt_get_repo_setup_script __wt_set_repo_setup_script __wt_detect_context __wt_choose_from_list __wt_pick_repo __wt_pick_worktree __wt_resolve_arg __wt_resolve_repo_root __wt_cleanup_helpers 2>/dev/null
}
