import type { Device, Session } from "./types";

function baseUrl(device: Device): string {
  return `http://${device.host}:${device.port}`;
}

export async function checkHealth(
  device: Device
): Promise<{ ok: boolean; tmux: boolean }> {
  const res = await fetch(`${baseUrl(device)}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  return res.json();
}

export async function fetchSessions(device: Device): Promise<Session[]> {
  const res = await fetch(`${baseUrl(device)}/sessions`);
  return res.json();
}

export function terminalWsUrl(
  device: Device,
  sessionId: string,
  paneIndex: number,
  cols: number,
  rows: number
): string {
  const encoded = encodeURIComponent(sessionId);
  return `ws://${device.host}:${device.port}/terminal/${encoded}/${paneIndex}?cols=${cols}&rows=${rows}`;
}
