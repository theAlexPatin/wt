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

export async function uploadFile(
  device: Device,
  uri: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const form = new FormData();
  form.append("file", {
    uri,
    name: filename,
    type: mimeType,
  } as any);
  const res = await fetch(`${baseUrl(device)}/upload`, {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  return json.path;
}

export async function createSession(device: Device): Promise<{ name: string }> {
  const res = await fetch(`${baseUrl(device)}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return res.json();
}

export async function deleteSession(device: Device, name: string): Promise<void> {
  await fetch(`${baseUrl(device)}/sessions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function renameSession(device: Device, oldName: string, newName: string): Promise<void> {
  await fetch(`${baseUrl(device)}/sessions/${encodeURIComponent(oldName)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
}

export async function registerPushToken(
  device: Device,
  token: string,
  deviceId: string
): Promise<void> {
  try {
    await fetch(`${baseUrl(device)}/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, deviceId }),
    });
  } catch {
    // Silent failure — server may be unreachable
  }
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
