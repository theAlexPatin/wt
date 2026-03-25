#!/bin/bash
set -e

WT_INSTALL_DIR="${WT_INSTALL_DIR:-$HOME/.wt}"

bold="\033[1m"
dim="\033[2m"
red="\033[31m"
cyan="\033[36m"
reset="\033[0m"

info()  { printf "${cyan}>${reset} %s\n" "$1"; }

echo ""
printf "${bold}Uninstalling wt${reset}\n"
echo ""

if [ -d "$WT_INSTALL_DIR" ]; then
  rm -rf "$WT_INSTALL_DIR"
  info "Removed $WT_INSTALL_DIR"
else
  info "$WT_INSTALL_DIR not found, skipping"
fi

for rc_file in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [ -f "$rc_file" ] && grep -qF "wt()" "$rc_file"; then
    sed -i.bak '/# wt — git worktree manager/d;/wt()/d' "$rc_file"
    rm -f "$rc_file.bak"
    info "Removed wt function from $rc_file"
  fi
done

echo ""
printf "${bold}Done.${reset} Restart your shell to complete removal.\n"
echo ""
printf "${dim}Note: Your worktrees in ~/.worktrees are untouched.${reset}\n"
echo ""
