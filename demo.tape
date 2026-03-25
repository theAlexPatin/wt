Output demo.gif

Require git

Set Shell "zsh"
Set FontSize 16
Set Width 980
Set Height 600
Set Padding 24
Set Theme { "name": "wt", "black": "#1e1e2e", "red": "#f38ba8", "green": "#a6e3a1", "yellow": "#f9e2af", "blue": "#89b4fa", "magenta": "#cba6f7", "cyan": "#89dceb", "white": "#cdd6f4", "brightBlack": "#585b70", "brightRed": "#f38ba8", "brightGreen": "#a6e3a1", "brightYellow": "#f9e2af", "brightBlue": "#89b4fa", "brightMagenta": "#cba6f7", "brightCyan": "#89dceb", "brightWhite": "#a6adc8", "background": "#1e1e2e", "foreground": "#cdd6f4", "selection": "#45475a", "cursor": "#f5e0dc" }
Set TypingSpeed 48ms

# Bootstrap: source wt and set up a temp repo
Hide
Type `WT_SRC="$PWD/src/main.sh"`
Enter
Type `export WT_ROOT="/tmp/wt-demo-trees"`
Enter
Type `rm -rf /tmp/wt-demo-repo /tmp/wt-demo-trees`
Enter
Type `git init /tmp/wt-demo-repo --initial-branch main -q && git -C /tmp/wt-demo-repo commit --allow-empty -m "init" -q`
Enter
Type `cd /tmp/wt-demo-repo`
Enter
Type `wt() { source "$WT_SRC" "$@" }`
Enter
Type `export PS1="%F{blue}wt-demo%f %F{cyan}%1~%f %F{magenta}>%f "`
Enter
Type `clear`
Enter
Show

# Scene 1: Create a worktree from the main repo checkout
Sleep 700ms
Type "# Create a feature worktree"
Enter
Sleep 600ms
Type "wt new auth-refactor"
Sleep 220ms
Enter
Sleep 1500ms

# Scene 2: Verify current path and branch
Type "pwd"
Sleep 220ms
Enter
Sleep 900ms

Type "git branch --show-current"
Sleep 220ms
Enter
Sleep 1200ms

# Scene 3: Create another worktree while already in a worktree
Type "# wt auto-resolves the source repo from here"
Enter
Sleep 600ms
Type "wt new fix-flaky-tests"
Sleep 220ms
Enter
Sleep 1300ms

# Scene 4: List worktrees for the current repo context
Type "wt ls"
Sleep 220ms
Enter
Sleep 1200ms

# Scene 5: Rename current worktree and matching branch
Type "wt cd auth-refactor"
Sleep 220ms
Enter
Sleep 1000ms

Type "wt rename auth-oauth"
Sleep 220ms
Enter
Sleep 1200ms

Type "pwd"
Sleep 220ms
Enter
Sleep 1200ms

# Scene 6: Remove a worktree from inside it (no args)
Type "wt cd fix-flaky-tests"
Sleep 220ms
Enter
Sleep 1000ms

Type "wt cleanup"
Sleep 220ms
Enter
Sleep 1400ms

Type "pwd"
Sleep 220ms
Enter
Sleep 900ms

Type "wt ls"
Sleep 220ms
Enter
Sleep 1400ms

# Scene 7: Jump in and return to the source repo
Type "wt cd auth-oauth"
Sleep 220ms
Enter
Sleep 900ms

Type "wt root"
Sleep 220ms
Enter
Sleep 800ms

Type "pwd"
Sleep 220ms
Enter
Sleep 1200ms

Sleep 1s
