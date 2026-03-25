#!/bin/bash
set -e

# wt-setup — adds the wt shell function pointing to the npm-installed source files.
# Run this once after `npm install -g @nitap/wt` or `yarn global add @nitap/wt`.

# Resolve the src/ directory relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/../src" && pwd)"

if [ ! -f "$SRC_DIR/main.sh" ]; then
  echo "Error: could not find wt source files at $SRC_DIR"
  exit 1
fi

SHELL_NAME="$(basename "$SHELL")"

# Colors
bold="\033[1m"
dim="\033[2m"
green="\033[32m"
cyan="\033[36m"
reset="\033[0m"

info()  { printf "${cyan}>${reset} %s\n" "$1"; }
done_() { printf "${green}>${reset} %s\n" "$1"; }

echo ""
printf "${bold}wt${reset} — git worktree manager\n"
echo ""

# Detect shell config
rc_file=""
case "$SHELL_NAME" in
  zsh)  rc_file="$HOME/.zshrc" ;;
  bash) rc_file="$HOME/.bashrc" ;;
  *)
    echo "Add this to your shell config:"
    echo ""
    echo "  wt() { source \"$SRC_DIR/main.sh\" \"\$@\" }"
    echo ""
    exit 0
    ;;
esac

ALIAS_LINE="wt() { source \"$SRC_DIR/main.sh\" \"\$@\" }"

if grep -qF "wt()" "$rc_file" 2>/dev/null; then
  # Update existing line to point to current install location
  if grep -qF "$SRC_DIR/main.sh" "$rc_file" 2>/dev/null; then
    info "Shell function already configured in $rc_file"
  else
    # Replace old wt() line with new path
    sed -i.bak '/wt() {/d' "$rc_file"
    rm -f "$rc_file.bak"
    {
      echo ""
      echo "# wt — git worktree manager (https://github.com/thealexpatin/wt)"
      echo "$ALIAS_LINE"
    } >> "$rc_file"
    done_ "Updated shell function in $rc_file"
  fi
else
  {
    echo ""
    echo "# wt — git worktree manager (https://github.com/thealexpatin/wt)"
    echo "$ALIAS_LINE"
  } >> "$rc_file"
  done_ "Added shell function to $rc_file"
fi

echo ""
printf "${bold}Done!${reset} Restart your shell or run:\n"
echo ""
printf "  ${dim}source $rc_file${reset}\n"
echo ""
printf "Then try: ${bold}wt new my-feature${reset}\n"
echo ""
