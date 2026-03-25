#!/bin/zsh
# wt setup — create the configured setup script in the current repo

local repo_root
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
  echo "Not in a git repository"
  return 1
fi

local setup_script_name=""
setup_script_name="$(__wt_get_repo_setup_script "$repo_root")"

local setup_file="$repo_root/$setup_script_name"

if [ -f "$setup_file" ]; then
  echo "$setup_script_name already exists at $repo_root"
  return 1
fi

cat > "$setup_file" <<'SETUP'
#!/bin/bash
# Worktree setup — runs automatically via `wt new`.
# Copies env files and symlinks build caches from the source worktree.

set -e

SKIP_DIRS=(node_modules .git dist build out .cache coverage)
CACHE_DIRS=(.turbo vendor .next .nuxt Pods)

get_main_worktree() {
  git worktree list | head -1 | awk '{print $1}'
}

CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
SOURCE_WORKTREE="${1:-$(get_main_worktree)}"
SOURCE_WORKTREE="$(cd "$SOURCE_WORKTREE" && pwd)"

if [ "$SOURCE_WORKTREE" = "$CURRENT_WORKTREE" ]; then
  echo "Error: Source and destination worktrees are the same."
  exit 1
fi

echo "Setting up worktree from: $SOURCE_WORKTREE"
echo "                      to: $CURRENT_WORKTREE"
echo ""

symlink_dir() {
  local rel_path="$1"
  local src="$SOURCE_WORKTREE/$rel_path"
  local dst="$CURRENT_WORKTREE/$rel_path"
  if [ -d "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    [ -L "$dst" ] && rm "$dst"
    [ -d "$dst" ] && rm -rf "$dst"
    ln -s "$src" "$dst"
    echo "  Symlinked: $rel_path"
  fi
}

copy_file() {
  local rel_path="$1"
  local src="$SOURCE_WORKTREE/$rel_path"
  local dst="$CURRENT_WORKTREE/$rel_path"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
    echo "  Copied: $rel_path"
  fi
}

skip_args=()
for dir in "${SKIP_DIRS[@]}"; do
  skip_args+=(-path "*/$dir" -prune -o)
done

cache_match=(-type d \()
for i in "${!CACHE_DIRS[@]}"; do
  [ "$i" -gt 0 ] && cache_match+=(-o)
  cache_match+=(-name "${CACHE_DIRS[$i]}")
done
cache_match+=(\) -print)

symlink_dir ".yarn/cache"

cd "$SOURCE_WORKTREE"
while IFS= read -r dir; do
  symlink_dir "${dir#./}"
done < <(find . "${skip_args[@]}" "${cache_match[@]}" 2>/dev/null)

while IFS= read -r file; do
  copy_file "${file#./}"
done < <(find . "${skip_args[@]}" -type f \( -name ".env" -o -name ".env.*" \) -print 2>/dev/null)

copy_file "lefthook-local.yml"
copy_file "lefthook-local.yaml"

echo ""
echo "Done! Next step: install dependencies (e.g. npm install, yarn install)"
SETUP

chmod +x "$setup_file"

local exclude_file
exclude_file="$(git -C "$repo_root" rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude_file")"

if ! grep -Fxq "$setup_script_name" "$exclude_file" 2>/dev/null; then
  printf '\n%s\n' "$setup_script_name" >> "$exclude_file"
fi

echo "Created $setup_file"
echo "Added $setup_script_name to .git/info/exclude"
