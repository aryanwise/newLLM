import type { FileContentResponse, SettingsPayload, WorkspaceDirectoriesResponse, WorkspaceFile } from "./types/engine";

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";

function responseMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail
      .flatMap((item: unknown) =>
        item && typeof item === "object" && "msg" in item && typeof item.msg === "string" ? [item.msg] : [],
      )
      .join(" ") || undefined;
  }
}

async function request<T>(path: string, failureMessage: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error("Could not reach the engine API. Check that the backend is running.");
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new Error(responseMessage(body) || `${failureMessage} (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function getModels(signal?: AbortSignal): Promise<string[]> {
  return request("/api/models", "Could not load models", { signal });
}

export function listWorkspaceDirectories(path?: string, signal?: AbortSignal): Promise<WorkspaceDirectoriesResponse> {
  const query = path ? `?${new URLSearchParams({ path })}` : "";
  return request(`/api/workspace/directories${query}`, "Could not browse folders", { signal });
}

export async function listWorkspaceFiles(path: string, signal?: AbortSignal): Promise<WorkspaceFile[]> {
  const query = new URLSearchParams({ path });
  const { files } = await request<{ files: WorkspaceFile[] }>(
    `/api/workspace/files?${query}`,
    "Could not list workspace files",
    { signal },
  );
  return files;
}

export function readWorkspaceFile(path: string, filename: string, signal?: AbortSignal): Promise<FileContentResponse> {
  const query = new URLSearchParams({ path, filename });
  return request(`/api/workspace/file?${query}`, "Could not read the source file", { signal });
}

export function getSettings(signal?: AbortSignal): Promise<SettingsPayload> {
  return request("/api/settings", "Could not load engine settings", { signal });
}

export function saveSettings(settings: SettingsPayload, signal?: AbortSignal): Promise<SettingsPayload> {
  return request("/api/settings", "Could not save engine settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    signal,
  });
}

export function engineSocketUrl(): URL {
  const url = new URL(`${baseUrl}/ws/execute`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}
