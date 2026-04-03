export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface SessionPane {
  index: number;
  windowIndex: number;
  windowName: string;
  active: boolean;
  size: string;
  isClaudeCode?: boolean;
}

export interface Session {
  id: string;
  name: string;
  tabTitle: string;
  tabColor: string | null;
  paneColor: string | null;
  windowCount: number;
  panes: SessionPane[];
  repo: string | null;
  worktree: string | null;
  attached: boolean;
  created: string;
}

export interface WorktreeInfo {
  name: string;
  tabTitle: string;
  tabColor?: string;
  paneColor?: string;
  path: string;
}

export interface CreateSessionResult {
  name: string;
  tabColor?: string;
  paneColor?: string;
}

export interface CreateWorktreeResult extends CreateSessionResult {
  worktree: string;
  path: string;
  tabTitle: string;
  setupRunning: boolean;
}
