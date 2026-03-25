#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WT_BIN="$REPO_ROOT/bin/wt"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wt-tests.XXXXXX")"

PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  local message="$1"
  echo "    ✗ $message" >&2
  return 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [[ "$actual" == "$expected" ]] || fail "$message (expected '$expected', got '$actual')"
}

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  [[ "$haystack" == *"$needle"* ]] || fail "$message (looking for '$needle')"
}

assert_not_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  [[ "$haystack" != *"$needle"* ]] || fail "$message (should not contain '$needle')"
}

assert_file_exists() {
  local path="$1"
  local message="$2"
  [[ -f "$path" ]] || fail "$message"
}

assert_dir_exists() {
  local path="$1"
  local message="$2"
  [[ -d "$path" ]] || fail "$message"
}

assert_json_value() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local message="$4"

  local actual
  actual="$(python3 - "$file" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
value = data.get(key)
if isinstance(value, str):
    print(value)
PY
  )"
  assert_eq "$expected" "$actual" "$message"
}

create_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "wt-tests"
  printf 'seed\n' > "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm "init"
}

# Run wt CLI with isolated HOME and WT_ROOT
run_wt() {
  local home_dir="$1"
  local cwd="$2"
  shift 2
  HOME="$home_dir" WT_ROOT="" WT_CONFIG_FILE="$home_dir/.wt/config.json" \
    node "$WT_BIN" "$@" 2>&1 < /dev/null &
  local pid=$!
  # Use a subshell with cd to set cwd, pipe through
  wait $pid 2>/dev/null || true
}

# Run wt with proper cwd (node respects the cwd of its process)
run_wt_in() {
  local home_dir="$1"
  local cwd="$2"
  shift 2
  (cd "$cwd" && HOME="$home_dir" WT_ROOT="" WT_CONFIG_FILE="$home_dir/.wt/config.json" \
    node "$WT_BIN" "$@" 2>&1 < /dev/null)
}

set_global_root() {
  local home_dir="$1"
  local root="$2"
  mkdir -p "$home_dir/.wt"
  python3 - "$home_dir/.wt/config.json" "$root" <<'PY'
import json, os, sys
path, root = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump({"worktreesRoot": root}, f, indent=2)
    f.write("\n")
PY
}

# --- Tests ---

test_non_interactive_requires_initialization() {
  local home_dir="$TMP_ROOT/home-init"
  mkdir -p "$home_dir"

  local output
  set +e
  output="$(run_wt_in "$home_dir" "$TMP_ROOT" ls)"
  local status=$?
  set -e

  assert_contains "not initialized" "$output" "missing initialization message" || return 1
}

test_ls_uses_configured_root() {
  local home_dir="$TMP_ROOT/home-ls"
  local configured_root="$home_dir/wt-root"
  mkdir -p "$home_dir"
  set_global_root "$home_dir" "$configured_root"

  local output
  output="$(run_wt_in "$home_dir" "$TMP_ROOT" ls)"

  assert_contains "No worktrees found" "$output" "ls output mismatch" || return 1
}

test_new_creates_worktree() {
  local home_dir="$TMP_ROOT/home-new"
  local repo="$TMP_ROOT/repo-new"
  local configured_root="$home_dir/worktrees"
  local wt_name="feature-one"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  local output
  output="$(run_wt_in "$home_dir" "$repo" new "$wt_name")"

  local repo_name
  repo_name="$(basename "$repo")"
  assert_dir_exists "$configured_root/$repo_name/$wt_name" "expected new worktree directory" || return 1

  local branch_match
  branch_match="$(git -C "$repo" branch --list "$wt_name")"
  [[ -n "$branch_match" ]] || fail "expected matching git branch" || return 1

  assert_contains "__wt_cd:" "$output" "expected cd output" || return 1
}

test_ls_after_new() {
  local home_dir="$TMP_ROOT/home-ls2"
  local repo="$TMP_ROOT/repo-ls2"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt_in "$home_dir" "$repo" new "feat-a" >/dev/null
  run_wt_in "$home_dir" "$repo" new "feat-b" >/dev/null

  local output
  output="$(run_wt_in "$home_dir" "$repo" ls)"
  local repo_name
  repo_name="$(basename "$repo")"

  assert_contains "$repo_name/feat-a" "$output" "expected feat-a in ls" || return 1
  assert_contains "$repo_name/feat-b" "$output" "expected feat-b in ls" || return 1
}

test_cd_direct() {
  local home_dir="$TMP_ROOT/home-cd"
  local repo="$TMP_ROOT/repo-cd"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt_in "$home_dir" "$repo" new "my-wt" >/dev/null

  local output repo_name
  repo_name="$(basename "$repo")"
  output="$(run_wt_in "$home_dir" "$repo" cd "$repo_name/my-wt")"

  assert_contains "__wt_cd:" "$output" "expected cd output" || return 1
  assert_contains "/$repo_name/my-wt" "$output" "expected worktree path" || return 1
}

test_rename() {
  local home_dir="$TMP_ROOT/home-rename"
  local repo="$TMP_ROOT/repo-rename"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt_in "$home_dir" "$repo" new "old-name" >/dev/null

  local output
  output="$(run_wt_in "$home_dir" "$repo" rename old-name new-name)"

  local repo_name
  repo_name="$(basename "$repo")"

  assert_contains "Branch: old-name -> new-name" "$output" "expected branch rename" || return 1
  assert_contains "Worktree: $repo_name/old-name -> $repo_name/new-name" "$output" "expected worktree rename" || return 1
  assert_dir_exists "$configured_root/$repo_name/new-name" "expected renamed directory" || return 1
  [[ ! -d "$configured_root/$repo_name/old-name" ]] || fail "old directory should be gone" || return 1
}

test_cleanup() {
  local home_dir="$TMP_ROOT/home-cleanup"
  local repo="$TMP_ROOT/repo-cleanup"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt_in "$home_dir" "$repo" new "to-remove" >/dev/null

  local repo_name
  repo_name="$(basename "$repo")"
  assert_dir_exists "$configured_root/$repo_name/to-remove" "worktree should exist before cleanup" || return 1

  local output
  output="$(run_wt_in "$home_dir" "$repo" cleanup "$repo_name/to-remove")"

  assert_contains "Removed $repo_name/to-remove" "$output" "expected removal message" || return 1
  [[ ! -d "$configured_root/$repo_name/to-remove" ]] || fail "worktree should be gone" || return 1
}

test_root() {
  local home_dir="$TMP_ROOT/home-root"
  local repo="$TMP_ROOT/repo-root"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt_in "$home_dir" "$repo" new "for-root" >/dev/null

  local repo_name wt_dir
  repo_name="$(basename "$repo")"
  wt_dir="$configured_root/$repo_name/for-root"

  local output
  output="$(run_wt_in "$home_dir" "$wt_dir" root)"

  assert_contains "__wt_cd:" "$output" "expected cd output" || return 1
}

test_setup_creates_script() {
  local home_dir="$TMP_ROOT/home-setup"
  local repo="$TMP_ROOT/repo-setup"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  local output
  output="$(run_wt_in "$home_dir" "$repo" setup)"

  assert_file_exists "$repo/.worktree-setup" "expected setup script" || return 1
  assert_contains "Created" "$output" "expected creation message" || return 1

  local exclude_contents
  exclude_contents="$(cat "$repo/.git/info/exclude")"
  assert_contains ".worktree-setup" "$exclude_contents" "expected setup script in git exclude" || return 1
}

test_setup_uses_configured_script_name() {
  local home_dir="$TMP_ROOT/home-setup-custom"
  local repo="$TMP_ROOT/repo-setup-custom"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  cat > "$repo/.wt.config.json" <<'JSON'
{
  "setupScript": "bootstrap.sh"
}
JSON

  run_wt_in "$home_dir" "$repo" setup >/dev/null

  assert_file_exists "$repo/bootstrap.sh" "expected custom setup script" || return 1
  local exclude_contents
  exclude_contents="$(cat "$repo/.git/info/exclude")"
  assert_contains "bootstrap.sh" "$exclude_contents" "expected custom script in git exclude" || return 1
}

test_new_runs_setup_script() {
  local home_dir="$TMP_ROOT/home-setup-run"
  local repo="$TMP_ROOT/repo-setup-run"
  local configured_root="$home_dir/worktrees"
  local wt_name="feat-setup"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  cat > "$repo/.wt.config.json" <<'JSON'
{
  "setupScript": "custom-setup.sh"
}
JSON

  cat > "$repo/custom-setup.sh" <<'SCRIPT'
#!/bin/bash
echo "$1" > .setup-marker
SCRIPT
  chmod +x "$repo/custom-setup.sh"

  run_wt_in "$home_dir" "$repo" new "$wt_name" >/dev/null

  local repo_name wt_path
  repo_name="$(basename "$repo")"
  wt_path="$configured_root/$repo_name/$wt_name"

  assert_file_exists "$wt_path/.setup-marker" "expected setup script marker" || return 1
}

test_help() {
  local output
  output="$(node "$WT_BIN" --help 2>&1)"

  assert_contains "Usage: wt" "$output" "expected usage line" || return 1
  assert_contains "new" "$output" "expected new command" || return 1
  assert_contains "cleanup" "$output" "expected cleanup command" || return 1
}

# --- Runner ---

run_test() {
  local test_name="$1"
  echo "→ $test_name"
  if "$test_name"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  ✓ passed"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  ✗ failed"
  fi
}

TESTS=(
  test_help
  test_non_interactive_requires_initialization
  test_ls_uses_configured_root
  test_new_creates_worktree
  test_ls_after_new
  test_cd_direct
  test_rename
  test_cleanup
  test_root
  test_setup_creates_script
  test_setup_uses_configured_script_name
  test_new_runs_setup_script
)

for test_name in "${TESTS[@]}"; do
  run_test "$test_name"
done

echo
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
