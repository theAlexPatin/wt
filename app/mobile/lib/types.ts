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
