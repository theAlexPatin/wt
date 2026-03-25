#!/bin/bash
set -e

# wt installer — copies source files and sets up shell alias

WT_INSTALL_DIR="${WT_INSTALL_DIR:-$HOME/.wt}"
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

# 1. Copy source files
info "Installing to $WT_INSTALL_DIR"
mkdir -p "$WT_INSTALL_DIR"
cp -f src/*.sh "$WT_INSTALL_DIR/"
done_ "Copied source files"

# 2. Detect shell config file
rc_file=""
case "$SHELL_NAME" in
  zsh)  rc_file="$HOME/.zshrc" ;;
  bash) rc_file="$HOME/.bashrc" ;;
  *)
    echo ""
    echo "Unsupported shell: $SHELL_NAME"
    echo "Add this to your shell config manually:"
    echo ""
    echo "  wt() { source \"$WT_INSTALL_DIR/main.sh\" \"\$@\" }"
    echo ""
    exit 0
    ;;
esac

# 3. Add alias if not already present
ALIAS_LINE="wt() { source \"$WT_INSTALL_DIR/main.sh\" \"\$@\" }"

if grep -qF "wt()" "$rc_file" 2>/dev/null; then
  info "Shell function already exists in $rc_file"
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
