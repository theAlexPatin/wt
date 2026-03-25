#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WT_MAIN="$REPO_ROOT/src/main.sh"
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
  [[ "$haystack" == *"$needle"* ]] || fail "$message"
}

assert_file_exists() {
  local path="$1"
  local message="$2"
  [[ -f "$path" ]] || fail "$message"
}

assert_json_value() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local message="$4"

  local actual
  actual="$(python3 - "$file" "$key" <<'PY'
import json
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
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

run_wt() {
  local home_dir="$1"
  local cwd="$2"
  shift 2
  HOME="$home_dir" zsh -c '
    wt_main="$1"
    shift
    wt() { source "$wt_main" "$@"; }
    cd "$1" || exit 1
    shift
    wt "$@"
  ' -- "$WT_MAIN" "$cwd" "$@"
}

set_global_root() {
  local home_dir="$1"
  local root="$2"
  mkdir -p "$home_dir/.wt"
  python3 - "$home_dir/.wt/config.json" "$root" <<'PY'
import json
import os
import sys

path, root = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8') as f:
    json.dump({"worktreesRoot": root}, f, indent=2, sort_keys=True)
    f.write("\n")
PY
}

test_non_interactive_requires_initialization() {
  local home_dir="$TMP_ROOT/home-init"
  mkdir -p "$home_dir"

  local output status
  set +e
  output="$(run_wt "$home_dir" "$TMP_ROOT" ls 2>&1)"
  status=$?
  set -e

  assert_eq "1" "$status" "ls should fail before initialization" || return 1
  assert_contains "wt is not initialized yet." "$output" "missing initialization prompt" || return 1
  assert_contains "Set your default worktrees location" "$output" "missing initialization guidance" || return 1
}

test_config_writes_global_and_project_json() {
  local home_dir="$TMP_ROOT/home-config"
  local repo="$TMP_ROOT/repo-config"
  local configured_root="$home_dir/worktrees-custom"
  create_repo "$repo"

  local output status
  set +e
  output="$(printf '%s\n%s\n' "$configured_root" "my-setup.sh" | HOME="$home_dir" zsh -c '
    wt_main="$1"
    shift
    wt() { source "$wt_main" "$@"; }
    cd "$1" || exit 1
    shift
    wt config
  ' -- "$WT_MAIN" "$repo" 2>&1)"
  status=$?
  set -e

  assert_eq "0" "$status" "wt config should succeed" || return 1
  assert_contains "Saved default worktrees location" "$output" "expected global save output" || return 1
  assert_contains "Saved setup script name" "$output" "expected project save output" || return 1
  assert_file_exists "$home_dir/.wt/config.json" "expected global config file" || return 1
  assert_file_exists "$repo/.wt.config.json" "expected project config file" || return 1
  assert_json_value "$home_dir/.wt/config.json" "worktreesRoot" "$configured_root" "global root was not persisted" || return 1
  assert_json_value "$repo/.wt.config.json" "setupScript" "my-setup.sh" "project setup script was not persisted" || return 1
}

test_ls_uses_configured_root() {
  local home_dir="$TMP_ROOT/home-ls"
  local configured_root="$home_dir/wt-root"
  mkdir -p "$home_dir"
  set_global_root "$home_dir" "$configured_root"

  local output status
  set +e
  output="$(run_wt "$home_dir" "$TMP_ROOT" ls 2>&1)"
  status=$?
  set -e

  assert_eq "0" "$status" "ls should succeed with configured root" || return 1
  assert_contains "No worktrees found." "$output" "ls output mismatch" || return 1
}

test_new_creates_worktree_under_configured_root() {
  local home_dir="$TMP_ROOT/home-new"
  local repo="$TMP_ROOT/repo-new"
  local configured_root="$home_dir/worktrees"
  local wt_name="feature-one"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  run_wt "$home_dir" "$repo" new "$wt_name" >/dev/null || return 1

  local repo_name
  repo_name="$(basename "$repo")"
  [[ -d "$configured_root/$repo_name/$wt_name" ]] || fail "expected new worktree directory" || return 1

  local branch_match
  branch_match="$(git -C "$repo" branch --list "$wt_name")"
  [[ -n "$branch_match" ]] || fail "expected matching git branch to be created" || return 1
}

test_new_runs_configured_setup_script() {
  local home_dir="$TMP_ROOT/home-setup-run"
  local repo="$TMP_ROOT/repo-setup-run"
  local configured_root="$home_dir/worktrees"
  local wt_name="feature-setup"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  cat > "$repo/.wt.config.json" <<'JSON'
{
  "setupScript": "custom-setup.sh"
}
JSON

  cat > "$repo/custom-setup.sh" <<'SCRIPT'
#!/bin/zsh
echo "$1" > .setup-source
SCRIPT
  chmod +x "$repo/custom-setup.sh"

  run_wt "$home_dir" "$repo" new "$wt_name" >/dev/null || return 1

  local repo_name wt_path
  repo_name="$(basename "$repo")"
  wt_path="$configured_root/$repo_name/$wt_name"
  assert_file_exists "$wt_path/.setup-source" "expected custom setup script marker" || return 1

  local expected_root actual_root
  expected_root="$(cd "$repo" && pwd -P)"
  actual_root="$(cat "$wt_path/.setup-source")"
  assert_eq "$expected_root" "$actual_root" "setup script should receive root repo path" || return 1
}

test_setup_creates_configured_script_name() {
  local home_dir="$TMP_ROOT/home-setup-command"
  local repo="$TMP_ROOT/repo-setup-command"
  local configured_root="$home_dir/worktrees"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  cat > "$repo/.wt.config.json" <<'JSON'
{
  "setupScript": "bootstrap-worktree.sh"
}
JSON

  run_wt "$home_dir" "$repo" setup >/dev/null || return 1

  assert_file_exists "$repo/bootstrap-worktree.sh" "expected configured setup script to be generated" || return 1
  local exclude_contents
  exclude_contents="$(cat "$repo/.git/info/exclude")"
  assert_contains "bootstrap-worktree.sh" "$exclude_contents" "expected setup script in git exclude" || return 1
}

test_worktree_config_targets_root_repo() {
  local home_dir="$TMP_ROOT/home-worktree-root"
  local repo="$TMP_ROOT/repo-worktree-root"
  local configured_root="$home_dir/worktrees"
  local secondary="$TMP_ROOT/secondary-worktree"
  create_repo "$repo"
  set_global_root "$home_dir" "$configured_root"

  git -C "$repo" worktree add -q "$secondary" -b secondary

  set +e
  printf '\nroot-only-setup.sh\n' | HOME="$home_dir" zsh -c '
    wt_main="$1"
    shift
    wt() { source "$wt_main" "$@"; }
    cd "$1" || exit 1
    shift
    wt config
  ' -- "$WT_MAIN" "$secondary" >/dev/null 2>&1
  local status=$?
  set -e

  assert_eq "0" "$status" "wt config should work from secondary worktree" || return 1
  assert_json_value "$repo/.wt.config.json" "setupScript" "root-only-setup.sh" "expected setup script on root repo config" || return 1
  [[ ! -f "$secondary/.wt.config.json" ]] || fail "secondary worktree should not get its own project config" || return 1
}

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
  test_non_interactive_requires_initialization
  test_config_writes_global_and_project_json
  test_ls_uses_configured_root
  test_new_creates_worktree_under_configured_root
  test_new_runs_configured_setup_script
  test_setup_creates_configured_script_name
  test_worktree_config_targets_root_repo
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
