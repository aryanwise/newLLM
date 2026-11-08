export const ENGINE_STAGES = [
  "PLANNING",
  "PROVISIONING",
  "GENERATING_TURN_1",
  "VERIFYING",
  "INTROSPECTING",
  "SPLICING",
  "VERIFYING_TURN_2",
  "GENERATING_FALLBACK",
  "VERIFYING_FALLBACK",
  "SUCCESS",
  "FAILURE",
] as const;

export type EngineStage = (typeof ENGINE_STAGES)[number];
export type ConnectionStatus = "CONNECTED" | "CONNECTING" | "DISCONNECTED";
export type RunStatus = "IDLE" | "PLANNING" | "PROVISIONING" | "GENERATING" | "HEALING" | "SUCCESS" | "FAILURE";
export type CodeState = "Turn 1 Draft" | "Surgically Repaired (AST Spliced)" | "Verified Passing" | "Full-file Repair";
export type ThemePreference = "system" | "light" | "dark";

export interface PromptMessage {
  id: string;
  prompt: string;
  status: "running" | "success" | "failure";
  filename?: string;
  error?: string;
}

export interface ExecuteRequest {
  prompt: string;
  workspace_path: string;
  model_name: string;
}

export interface SettingsPayload {
  base_url: string;
  model_name: string;
  workspace_path: string;
}

export interface WorkspaceFile {
  filename: string;
  size: number;
  modified_at: string;
}

export interface WorkspaceDirectoriesResponse {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
}

export interface FileContentResponse {
  path: string;
  content: string;
  exists: boolean;
}

export interface PlanMetadata {
  target_filename: string;
  dependencies: string[];
}

export interface InspectedSymbol {
  package: string;
  symbol: string;
  signature: string | null;
  doc: string | null;
  example: string | null;
}

export interface EventPayload extends Partial<PlanMetadata> {
  traceback?: string;
  symbols?: InspectedSymbol[];
  line_number?: number;
  start_byte?: number;
  end_byte?: number;
  start_point?: [row: number, column: number];
  end_point?: [row: number, column: number];
  node_type?: string;
  source_slice?: string;
  repair_error?: string;
  attempts?: number;
  stdout?: string;
  stderr?: string;
}

export interface WebSocketEvent {
  stage: EngineStage;
  message: string;
  timestamp: string;
  file_content?: string | null;
  payload?: EventPayload | null;
}
