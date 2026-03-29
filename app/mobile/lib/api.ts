import type { Device, Session } from "./types";

function baseUrl(device: Device): string {
  return `http://${device.host}:${device.port}`;
}

export async function checkHealth(
  device: Device
): Promise<{ ok: boolean; tmux: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const res = await fetch(`${baseUrl(device)}/health`, {
    signal: controller.signal,
  });
  clearTimeout(timer);
  return res.json();
}

export async function fetchSessions(device: Device): Promise<Session[]> {
  const res = await fetch(`${baseUrl(device)}/sessions`);
  return res.json();
}

export function terminalWsUrl(
  device: Device,
  sessionId: string,
  windowIndex: number,
  paneIndex: number,
  cols: number,
  rows: number
): string {
  const encoded = encodeURIComponent(sessionId);
  return `ws://${device.host}:${device.port}/terminal/${encoded}/${windowIndex}/${paneIndex}?cols=${cols}&rows=${rows}`;
}
