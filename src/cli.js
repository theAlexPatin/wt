const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawnSync } = require("child_process");
const { select, text, isCancel } = require("@clack/prompts");

// --- Protocol ---
// Commands that need to change the caller's directory output __wt_cd:<path>
// The thin shell wrapper picks this up and runs `cd`.

const CD_PREFIX = "__wt_cd:";

function cdOut(dir) {
  console.log(`${CD_PREFIX}${dir}`);
}

// --- Config ---

const CONFIG_FILE =
  process.env.WT_CONFIG_FILE ||
  path.join(os.homedir(), ".wt", "config.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function getConfig(file, key) {
  const data = readJson(file);
  return typeof data[key] === "string" ? data[key] : null;
}

function setConfig(file, key, value) {
  const data = readJson(file);
  data[key] = value;
  writeJson(file, data);
}

function normalizePath(p) {
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) p = path.resolve(p);
  return p.replace(/\/+$/, "") || "/";
}

function getWtRoot() {
  if (process.env.WT_ROOT) return normalizePath(process.env.WT_ROOT);
  const configured = getConfig(CONFIG_FILE, "worktreesRoot");
  if (configured) return normalizePath(configured);
  return null;
}

async function ensureInitialized() {
  let root = getWtRoot();
  if (root) return root;

  const defaultRoot = path.join(os.homedir(), ".worktrees");

  if (!process.stdin.isTTY) {
    console.error(
      "wt is not initialized yet.\nSet your default worktrees location with 'wt config' in an interactive shell."
    );
    process.exit(1);
  }

  console.log("wt is not initialized yet.\n");
  const chosen = await text({
    message: "Default worktrees location",
    initialValue: defaultRoot,
  });
  if (isCancel(chosen)) process.exit(0);

  root = normalizePath(chosen || defaultRoot);
  setConfig(CONFIG_FILE, "worktreesRoot", root);
  console.log(`Saved default worktrees location: ${root}`);
  return root;
}

// --- Git helpers ---

function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function gitOrFail(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    }).trim();
  } catch {
    return null;
  }
}

function repoRootFromWorktree(wtPath) {
  let realPath = wtPath;
  try {
    const stat = fs.lstatSync(wtPath);
    if (stat.isSymbolicLink()) realPath = fs.readlinkSync(wtPath);
  } catch {
    return null;
  }
  const gitFile = path.join(realPath, ".git");
  if (!fs.existsSync(gitFile) || fs.statSync(gitFile).isDirectory()) return null;
  const porcelain = git("worktree list --porcelain", realPath);
  if (!porcelain) return null;
  const match = porcelain.match(/^worktree (.+)$/m);
  return match ? match[1] : null;
}

function gitTopLevel(cwd) {
  return git("rev-parse --show-toplevel", cwd);
}

// --- Context detection ---

function realCwd() {
  try { return fs.realpathSync(process.cwd()); } catch { return process.cwd(); }
}

function realPath(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function detectContext(wtRoot) {
  const cwd = realCwd();
  const resolvedRoot = realPath(wtRoot);
  let detectedRepo = null;
  let detectedWt = null;

  if (resolvedRoot && cwd.startsWith(resolvedRoot + "/")) {
    const rel = cwd.slice(resolvedRoot.length + 1);
    const parts = rel.split("/");
    detectedRepo = parts[0] || null;
    detectedWt = parts[1] || null;
  } else {
    const gitRoot = gitTopLevel(cwd);
    if (gitRoot && wtRoot) {
      const name = path.basename(gitRoot);
      if (fs.existsSync(path.join(wtRoot, name))) detectedRepo = name;
    }
  }
  return { detectedRepo, detectedWt };
}

// --- Repo config ---

function configRepoRoot(repoPath) {
  const porcelain = git(
    "worktree list --porcelain",
    repoPath || process.cwd()
  );
  if (porcelain) {
    const match = porcelain.match(/^worktree (.+)$/m);
    if (match) {
      try {
        return fs.realpathSync(match[1]);
      } catch {}
    }
  }
  const toplevel = gitTopLevel(repoPath || process.cwd());
  if (toplevel) {
    try {
      return fs.realpathSync(toplevel);
    } catch {}
  }
  return null;
}

function repoConfigFile(repoPath) {
  const root = configRepoRoot(repoPath);
  return root ? path.join(root, ".wt.config.json") : null;
}

function getRepoSetupScript(repoPath) {
  const configFile = repoConfigFile(repoPath);
  if (configFile) {
    const val = getConfig(configFile, "setupScript");
    if (val) return val;
  }
  return ".worktree-setup";
}

function setRepoSetupScript(scriptName, repoPath) {
  const configFile = repoConfigFile(repoPath);
  if (!configFile) return false;
  setConfig(configFile, "setupScript", scriptName);
  return true;
}

// --- Pickers ---

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function pickRepo(wtRoot, detectedRepo, header = "Select repo") {
  if (detectedRepo && fs.existsSync(path.join(wtRoot, detectedRepo))) {
    return detectedRepo;
  }
  const repos = listDirs(wtRoot);
  if (repos.length === 0) return null;
  if (repos.length === 1) return repos[0];

  const chosen = await select({
    message: header,
    options: repos.map((r) => ({ value: r, label: r })),
  });
  if (isCancel(chosen)) return null;
  return chosen;
}

async function pickWorktree(
  wtRoot,
  repo,
  detectedWt,
  header = "Select worktree"
) {
  const repoDir = path.join(wtRoot, repo);
  if (detectedWt && fs.existsSync(path.join(repoDir, detectedWt))) {
    return detectedWt;
  }
  const worktrees = listDirs(repoDir);
  if (worktrees.length === 0) return null;
  if (worktrees.length === 1) return worktrees[0];

  const chosen = await select({
    message: header,
    options: worktrees.map((w) => ({ value: w, label: w })),
  });
  if (isCancel(chosen)) return null;
  return chosen;
}

function resolveArg(wtRoot, arg, detectedRepo) {
  if (arg.includes("/")) {
    const [repo, wt] = [arg.split("/")[0], arg.split("/").slice(1).join("/")];
    const dir = path.join(wtRoot, repo, wt);
    if (!fs.existsSync(dir)) {
      console.error(`Worktree not found: ${repo}/${wt}`);
      return null;
    }
    return { repo, wt };
  }
  if (!detectedRepo) {
    console.error("Not in a repo context. Use: <repo>/<worktree>");
    return null;
  }
  const dir = path.join(wtRoot, detectedRepo, arg);
  if (!fs.existsSync(dir)) {
    console.error(`Worktree not found: ${detectedRepo}/${arg}`);
    return null;
  }
  return { repo: detectedRepo, wt: arg };
}

// --- Commands ---

async function cmdNew(wtRoot, args) {
  let name = args[0];
  if (!name) {
    const bytes = require("crypto").randomBytes(4).toString("hex");
    name = `wt-${bytes}`;
  }

  const cwd = realCwd();
  const { detectedRepo, detectedWt } = detectContext(wtRoot);
  let repoRoot = null;
  let repo = null;

  if (detectedRepo && cwd.startsWith(realPath(wtRoot) + "/")) {
    repo = detectedRepo;
    const currentWtPath = path.join(wtRoot, detectedRepo, detectedWt);
    repoRoot = repoRootFromWorktree(currentWtPath);
    if (!repoRoot) {
      console.error(
        `Could not resolve source repo for ${detectedRepo}/${detectedWt}`
      );
      process.exit(1);
    }
  } else {
    const toplevel = gitTopLevel(cwd);
    if (toplevel) {
      repoRoot = toplevel;
      repo = path.basename(repoRoot);
    } else {
      repo = await pickRepo(wtRoot, detectedRepo, "Select repo for new worktree");
      if (!repo) {
        console.error(
          "Not in a git repository and no existing worktree repos found."
        );
        process.exit(1);
      }
      const dirs = listDirs(path.join(wtRoot, repo));
      if (dirs.length === 0) {
        console.error(`No worktrees found for ${repo} to resolve source repo.`);
        process.exit(1);
      }
      repoRoot = repoRootFromWorktree(path.join(wtRoot, repo, dirs[0]));
      if (!repoRoot) {
        console.error(`Could not resolve source repo for ${repo}`);
        process.exit(1);
      }
    }
  }

  const wtPath = path.join(wtRoot, repo, name);
  if (fs.existsSync(wtPath)) {
    console.error(`Worktree already exists: ${wtPath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(wtRoot, repo), { recursive: true });
  const result = gitOrFail(`worktree add "${wtPath}" -b "${name}"`, repoRoot);
  if (result === null) process.exit(1);

  // Run setup script if it exists
  const setupScriptName = getRepoSetupScript(repoRoot);
  const setupScriptPath = path.join(repoRoot, setupScriptName);
  if (fs.existsSync(setupScriptPath)) {
    console.log(`Running ${setupScriptName}...`);
    spawnSync("bash", [setupScriptPath, repoRoot], {
      cwd: wtPath,
      stdio: "inherit",
    });
  }

  cdOut(wtPath);
}

async function cmdCd(wtRoot, args) {
  if (!fs.existsSync(wtRoot) || listDirs(wtRoot).length === 0) {
    console.error(`No worktrees found in ${wtRoot}`);
    process.exit(0);
  }

  const { detectedRepo, detectedWt } = detectContext(wtRoot);

  if (args[0]) {
    const resolved = resolveArg(wtRoot, args[0], detectedRepo);
    if (!resolved) process.exit(1);
    cdOut(path.join(wtRoot, resolved.repo, resolved.wt));
    return;
  }

  const repo = await pickRepo(wtRoot, detectedRepo, "Select repo");
  if (!repo) {
    console.error(`No worktrees found in ${wtRoot}`);
    return;
  }

  const wt = await pickWorktree(wtRoot, repo, null, `Select worktree (${repo})`);
  if (!wt) {
    console.error(`No worktrees found for ${repo}`);
    return;
  }

  cdOut(path.join(wtRoot, repo, wt));
}

function cmdLs(wtRoot) {
  if (!fs.existsSync(wtRoot) || listDirs(wtRoot).length === 0) {
    console.log("No worktrees found.");
    return;
  }

  const { detectedRepo } = detectContext(wtRoot);
  let filterRepo = detectedRepo;
  if (filterRepo && !fs.existsSync(path.join(wtRoot, filterRepo)))
    filterRepo = null;

  let found = false;
  for (const repo of listDirs(wtRoot)) {
    if (filterRepo && repo !== filterRepo) continue;
    for (const wt of listDirs(path.join(wtRoot, repo))) {
      console.log(`${repo}/${wt}`);
      found = true;
    }
  }
  if (!found) console.log("No worktrees found.");
}

async function cmdRename(wtRoot, args) {
  const { detectedRepo, detectedWt } = detectContext(wtRoot);
  let oldName = args[0];
  let newName = args[1];
  let repo = null;
  let wtPath = null;

  if (oldName && newName) {
    // 2-arg: find old across repos
    const matches = listDirs(wtRoot).filter((r) =>
      fs.existsSync(path.join(wtRoot, r, oldName))
    );
    if (matches.length === 0) {
      console.error(`Worktree '${oldName}' not found.`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(
        `Ambiguous: '${oldName}' exists in multiple repos: ${matches.join(", ")}`
      );
      process.exit(1);
    }
    repo = matches[0];
    wtPath = path.join(wtRoot, repo, oldName);
  } else {
    // 0-arg or 1-arg
    if (oldName) newName = oldName;

    repo = await pickRepo(wtRoot, detectedRepo, "Select repo");
    if (!repo) {
      console.log("No worktrees found.");
      return;
    }

    if (newName) {
      if (!detectedWt) {
        console.error("Not inside a worktree. Use: wt rename <old> <new>");
        process.exit(1);
      }
      oldName = detectedWt;
    } else {
      const picked = await pickWorktree(
        wtRoot,
        repo,
        null,
        `Select worktree to rename (${repo})`
      );
      if (!picked) return;
      oldName = picked;

      const input = await text({
        message: "New name",
        placeholder: oldName,
      });
      if (isCancel(input) || !input) return;
      if (input === oldName) {
        console.log("Name unchanged.");
        return;
      }
      newName = input;
    }

    wtPath = path.join(wtRoot, repo, oldName);
  }

  const newWtPath = path.join(wtRoot, repo, newName);
  if (fs.existsSync(newWtPath)) {
    console.error(`Worktree '${newName}' already exists in ${repo}.`);
    process.exit(1);
  }

  let resolvedWtPath = wtPath;
  try {
    if (fs.lstatSync(wtPath).isSymbolicLink()) resolvedWtPath = fs.readlinkSync(wtPath);
  } catch {}

  const repoRoot = repoRootFromWorktree(wtPath);
  if (!repoRoot) {
    console.error(`Could not resolve source repo for ${repo}/${oldName}`);
    process.exit(1);
  }

  const oldBranch = git("rev-parse --abbrev-ref HEAD", resolvedWtPath);
  if (oldBranch && oldBranch !== "HEAD") {
    const result = gitOrFail(`branch -m "${oldBranch}" "${newName}"`, repoRoot);
    if (result === null) {
      console.error(`Failed to rename branch '${oldBranch}' to '${newName}'`);
      process.exit(1);
    }
    console.log(`  Branch: ${oldBranch} -> ${newName}`);
  }

  const moveResult = gitOrFail(
    `worktree move "${resolvedWtPath}" "${newWtPath}"`,
    repoRoot
  );
  if (moveResult === null) {
    console.error("Failed to move worktree");
    process.exit(1);
  }

  try {
    if (fs.lstatSync(wtPath).isSymbolicLink()) fs.unlinkSync(wtPath);
  } catch {}

  console.log(`  Worktree: ${repo}/${oldName} -> ${repo}/${newName}`);

  // If cwd was inside old path, cd to new
  const cwdNow = realCwd();
  const realOld = realPath(resolvedWtPath);
  if (cwdNow.startsWith(realOld)) {
    cdOut(cwdNow.replace(realOld, newWtPath));
  }
}

async function cmdCleanup(wtRoot, args) {
  if (!fs.existsSync(wtRoot) || listDirs(wtRoot).length === 0) {
    console.log(`No worktrees found in ${wtRoot}`);
    return;
  }

  const cwd = realCwd();
  const { detectedRepo, detectedWt } = detectContext(wtRoot);

  function removeWorktree(wtPath) {
    let realPath = wtPath;
    try {
      if (fs.lstatSync(wtPath).isSymbolicLink()) {
        realPath = fs.readlinkSync(wtPath);
        fs.unlinkSync(wtPath);
      }
    } catch {}

    const branch = git("rev-parse --abbrev-ref HEAD", realPath);
    const rr = repoRootFromWorktree(realPath) || repoRootFromWorktree(wtPath);

    let removed = false;
    if (rr && fs.existsSync(rr)) {
      const res = git(`worktree remove "${realPath}" --force`, rr);
      if (res !== null) removed = true;
    }
    if (!removed && fs.existsSync(realPath)) {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
    if (rr && fs.existsSync(rr)) git("worktree prune", rr);
    if (rr && fs.existsSync(rr) && branch && branch !== "HEAD") {
      git(`branch -D "${branch}"`, rr);
    }

    return rr;
  }

  function cleanupSingle(repo, wt) {
    const wtPath = path.join(wtRoot, repo, wt);
    const repoRoot = repoRootFromWorktree(wtPath);
    removeWorktree(wtPath);
    console.log(`  Removed ${repo}/${wt}`);

    const repoDir = path.join(wtRoot, repo);
    if (fs.existsSync(repoDir) && listDirs(repoDir).length === 0) {
      fs.rmdirSync(repoDir);
      console.log(`  Cleaned up empty ${repo}/`);
    }

    if (cwd.startsWith(wtPath)) {
      if (repoRoot && fs.existsSync(repoRoot)) {
        cdOut(repoRoot);
      } else {
        cdOut(wtRoot);
      }
    }
  }

  // Direct arg
  if (args[0]) {
    const resolved = resolveArg(wtRoot, args[0], detectedRepo);
    if (!resolved) process.exit(1);
    cleanupSingle(resolved.repo, resolved.wt);
    return;
  }

  // Inside a worktree: remove it
  if (detectedWt && fs.existsSync(path.join(wtRoot, detectedRepo, detectedWt))) {
    cleanupSingle(detectedRepo, detectedWt);
    return;
  }

  // Interactive
  const repo = await pickRepo(wtRoot, detectedRepo, "Select repo to clean up");
  if (!repo) {
    console.log("No worktree repos remaining.");
    return;
  }

  while (true) {
    const wts = listDirs(path.join(wtRoot, repo));
    if (wts.length === 0) {
      console.log(`No worktrees remaining for ${repo}`);
      try { fs.rmdirSync(path.join(wtRoot, repo)); } catch {}
      break;
    }

    const picked = await select({
      message: `Select worktree to remove (${repo})`,
      options: [
        ...wts.map((w) => ({ value: w, label: w })),
        { value: "__done__", label: "(done)" },
      ],
    });
    if (isCancel(picked) || picked === "__done__") break;

    removeWorktree(path.join(wtRoot, repo, picked));
    console.log(`  Removed ${repo}/${picked}`);

    const repoDir = path.join(wtRoot, repo);
    if (fs.existsSync(repoDir) && listDirs(repoDir).length === 0) {
      fs.rmdirSync(repoDir);
      console.log(`  Cleaned up empty ${repo}/`);
      break;
    }
  }
}

function cmdRoot(wtRoot) {
  const cwd = realCwd();
  const resolvedRoot = realPath(wtRoot);
  if (!cwd.startsWith(resolvedRoot + "/")) {
    console.error("Not in a worktree directory");
    return;
  }
  const rel = cwd.slice(resolvedRoot.length + 1);
  const parts = rel.split("/");
  const repo = parts[0];
  const wtName = parts[1];
  if (!wtName) {
    console.error("Not in a worktree directory");
    return;
  }
  const repoRoot = repoRootFromWorktree(path.join(wtRoot, repo, wtName));
  if (!repoRoot) {
    console.error(`Could not resolve source repo for ${repo}/${wtName}`);
    process.exit(1);
  }
  cdOut(repoRoot);
}

function cmdSetup(wtRoot) {
  const repoRoot = gitTopLevel(process.cwd());
  if (!repoRoot) {
    console.error("Not in a git repository");
    process.exit(1);
  }

  const setupScriptName = getRepoSetupScript(repoRoot);
  const setupFile = path.join(repoRoot, setupScriptName);

  if (fs.existsSync(setupFile)) {
    console.error(`${setupScriptName} already exists at ${repoRoot}`);
    process.exit(1);
  }

  const template = `#!/bin/bash
# Worktree setup — runs automatically via \`wt new\`.
# Copies env files and symlinks build caches from the source worktree.

set -e

SKIP_DIRS=(node_modules .git dist build out .cache coverage)
CACHE_DIRS=(.turbo vendor .next .nuxt Pods)

get_main_worktree() {
  git worktree list | head -1 | awk '{print $1}'
}

CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
SOURCE_WORKTREE="\${1:-$(get_main_worktree)}"
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
for dir in "\${SKIP_DIRS[@]}"; do
  skip_args+=(-path "*/$dir" -prune -o)
done

cache_match=(-type d \\()
for i in "\${!CACHE_DIRS[@]}"; do
  [ "$i" -gt 0 ] && cache_match+=(-o)
  cache_match+=(-name "\${CACHE_DIRS[$i]}")
done
cache_match+=(\\) -print)

symlink_dir ".yarn/cache"

cd "$SOURCE_WORKTREE"
while IFS= read -r dir; do
  symlink_dir "\${dir#./}"
done < <(find . "\${skip_args[@]}" "\${cache_match[@]}" 2>/dev/null)

while IFS= read -r file; do
  copy_file "\${file#./}"
done < <(find . "\${skip_args[@]}" -type f \\( -name ".env" -o -name ".env.*" \\) -print 2>/dev/null)

copy_file "lefthook-local.yml"
copy_file "lefthook-local.yaml"

echo ""
echo "Done! Next step: install dependencies (e.g. npm install, yarn install)"
`;

  fs.writeFileSync(setupFile, template, { mode: 0o755 });

  // Add to .git/info/exclude
  const excludeFile = git("rev-parse --git-path info/exclude", repoRoot);
  if (excludeFile) {
    const absExclude = path.isAbsolute(excludeFile)
      ? excludeFile
      : path.join(repoRoot, excludeFile);
    fs.mkdirSync(path.dirname(absExclude), { recursive: true });
    const content = fs.existsSync(absExclude)
      ? fs.readFileSync(absExclude, "utf8")
      : "";
    if (!content.split("\n").includes(setupScriptName)) {
      fs.appendFileSync(absExclude, `\n${setupScriptName}\n`);
    }
  }

  console.log(`Created ${setupFile}`);
  console.log(`Added ${setupScriptName} to .git/info/exclude`);
}

async function cmdConfig(wtRoot) {
  console.log("wt configuration\n");

  const currentRoot = wtRoot || path.join(os.homedir(), ".worktrees");
  const desiredRoot = await text({
    message: "Default worktrees location",
    initialValue: currentRoot,
  });
  if (isCancel(desiredRoot)) return;

  if (desiredRoot) {
    const normalized = normalizePath(desiredRoot);
    if (normalized !== currentRoot) {
      setConfig(CONFIG_FILE, "worktreesRoot", normalized);
      console.log(`Saved default worktrees location: ${normalized}`);
    } else {
      console.log(`Default worktrees location unchanged: ${currentRoot}`);
    }
  }

  const gitRoot = gitTopLevel(process.cwd());
  if (gitRoot) {
    const currentDir = fs.realpathSync(process.cwd());
    const worktreeRoot = fs.realpathSync(gitRoot);
    const mainRoot = configRepoRoot(process.cwd());

    // Only show repo config when at the worktree root
    if (currentDir === worktreeRoot || currentDir === mainRoot) {
      const currentSetup = getRepoSetupScript(gitRoot);
      const desiredSetup = await text({
        message: "Setup script name for this repository",
        initialValue: currentSetup,
      });
      if (!isCancel(desiredSetup) && desiredSetup) {
        if (desiredSetup !== currentSetup) {
          if (setRepoSetupScript(desiredSetup, gitRoot)) {
            console.log(
              `Saved setup script name for ${path.basename(mainRoot || gitRoot)}: ${desiredSetup}`
            );
          } else {
            console.error("Failed to save setup script name");
          }
        } else {
          console.log(`Setup script name unchanged: ${currentSetup}`);
        }
      }
    } else {
      console.log(
        "Repo setup script is configurable from the worktree root directory."
      );
    }
  }
}

function cmdHelp() {
  console.log(`Usage: wt <command> [args]

Commands:
  new       Create a new worktree
  cd        Open a worktree
  ls        List worktrees
  config    Configure defaults and repo setup script
  rename    Rename a worktree and its branch
  cleanup   Remove a worktree
  setup     Create the configured setup script in the current repo
  root      Navigate to source repo from a worktree

Options:
  --help    Show this help message

Environment:
  WT_ROOT          Base directory for worktrees (default: ~/.worktrees)
  WT_CONFIG_FILE   Config file path (default: ~/.wt/config.json)`);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const cmdArgs = args.slice(1);

  // Commands that need WT_ROOT
  const needsInit = ["ls", "cd", "new", "cleanup", "rename", "setup", "root"];

  let wtRoot = getWtRoot();
  if (needsInit.includes(cmd)) {
    wtRoot = await ensureInitialized();
  }

  switch (cmd) {
    case "new":
      return cmdNew(wtRoot, cmdArgs);
    case "cd":
      return cmdCd(wtRoot, cmdArgs);
    case "ls":
      return cmdLs(wtRoot);
    case "rename":
      return cmdRename(wtRoot, cmdArgs);
    case "cleanup":
      return cmdCleanup(wtRoot, cmdArgs);
    case "root":
      return cmdRoot(wtRoot);
    case "setup":
      return cmdSetup(wtRoot);
    case "config":
      return cmdConfig(wtRoot);
    case "--help":
    case "-h":
    case undefined:
      return cmdHelp();
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Run 'wt --help' for usage.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
