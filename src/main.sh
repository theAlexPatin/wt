#!/bin/zsh
# wt — git worktree manager
# Usage: wt <command> [args]

local __wt_dir="${0:A:h}"
[ -z "$__wt_dir" ] && __wt_dir="${WT_DIR:-$HOME/.wt}"

source "$__wt_dir/_helpers.sh"

local __wt_cmd="$1"
[ -n "$__wt_cmd" ] && shift

case "$__wt_cmd" in
  ls|cd|new|cleanup|rename|setup|root)
    __wt_ensure_initialized || {
      __wt_cleanup_helpers 2>/dev/null
      return 1
    }
    ;;
esac

case "$__wt_cmd" in
  ls)      source "$__wt_dir/ls.sh" "$@" ;;
  cd)      source "$__wt_dir/open.sh" "$@" ;;
  new)     source "$__wt_dir/new.sh" "$@" ;;
  config)  source "$__wt_dir/config.sh" "$@" ;;
  cleanup) source "$__wt_dir/cleanup.sh" "$@" ;;
  rename)  source "$__wt_dir/rename.sh" "$@" ;;
  setup)   source "$__wt_dir/setup.sh" "$@" ;;
  root)    source "$__wt_dir/root.sh" "$@" ;;
  --help|-h|"")
    echo "Usage: wt <command> [args]"
    echo ""
    echo "Commands:"
    echo "  new       Create a new worktree"
    echo "  cd        Open a worktree"
    echo "  ls        List worktrees"
    echo "  config    Configure defaults and repo setup script"
    echo "  rename    Rename a worktree and its branch"
    echo "  cleanup   Remove a worktree"
    echo "  setup     Create the configured setup script in the current repo"
    echo "  root      Navigate to source repo from a worktree"
    echo ""
    echo "Options:"
    echo "  --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  WT_ROOT   Base directory for worktrees (default: ~/.worktrees)"
    echo "  WT_CONFIG_FILE   Config file path (default: ~/.wt/config.json)"
    ;;
  *)
    echo "Unknown command: $__wt_cmd"
    echo "Run 'wt --help' for usage."
    return 1
    ;;
esac

__wt_cleanup_helpers 2>/dev/null
