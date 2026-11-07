import { useCallback, useEffect, useReducer, useRef } from "react";

import { engineSocketUrl } from "../api";
import {
  ENGINE_STAGES,
  type CodeState,
  type ConnectionStatus,
  type EngineStage,
  type ExecuteRequest,
  type PlanMetadata,
  type RunStatus,
  type WebSocketEvent,
} from "../types/engine";

interface EngineState {
  logs: WebSocketEvent[];
  fileContent: string | null;
  codeState: CodeState | null;
  plan: PlanMetadata | null;
  isExecuting: boolean;
  currentStage: EngineStage | null;
  error: string | null;
  connectionStatus: ConnectionStatus;
}

const idle: EngineState = {
  logs: [],
  fileContent: null,
  codeState: null,
  plan: null,
  isExecuting: false,
  currentStage: null,
  error: null,
  connectionStatus: "DISCONNECTED",
};

const runStatuses: Record<EngineStage, RunStatus> = {
  PLANNING: "PLANNING",
  PROVISIONING: "PROVISIONING",
  GENERATING_TURN_1: "GENERATING",
  VERIFYING: "GENERATING",
  INTROSPECTING: "HEALING",
  SPLICING: "HEALING",
  VERIFYING_TURN_2: "HEALING",
  GENERATING_FALLBACK: "HEALING",
  VERIFYING_FALLBACK: "HEALING",
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
};

const codeStates: Partial<Record<EngineStage, CodeState>> = {
  VERIFYING: "Turn 1 Draft",
  SPLICING: "Surgically Repaired (AST Spliced)",
  VERIFYING_TURN_2: "Surgically Repaired (AST Spliced)",
  VERIFYING_FALLBACK: "Full-file Repair",
  SUCCESS: "Verified Passing",
};

type Action =
  | { type: "start" }
  | { type: "connected" }
  | { type: "clear" }
  | { type: "event"; event: WebSocketEvent };

function isTerminal(stage: EngineStage): boolean {
  return stage === "SUCCESS" || stage === "FAILURE";
}

function update(state: EngineState, action: Action): EngineState {
  switch (action.type) {
    case "start":
      return { ...idle, isExecuting: true, connectionStatus: "CONNECTING" };
    case "connected":
      return { ...state, connectionStatus: "CONNECTED" };
    case "clear":
      return { ...state, logs: [] };
    case "event": {
      const { event } = action;
      const terminal = isTerminal(event.stage);
      const { target_filename, dependencies } = event.payload ?? {};
      const fileContent = event.file_content ?? state.fileContent;
      return {
        logs: [...state.logs, event],
        fileContent,
        codeState: fileContent === null ? null : codeStates[event.stage] ?? state.codeState,
        plan: typeof target_filename === "string" && Array.isArray(dependencies)
          ? { target_filename, dependencies }
          : state.plan,
        isExecuting: !terminal,
        currentStage: event.stage,
        error: event.stage === "FAILURE" ? event.message : null,
        connectionStatus: terminal ? "DISCONNECTED" : state.connectionStatus,
      };
    }
  }
}

function parseEvent(data: unknown): WebSocketEvent | null {
  if (typeof data !== "string") return null;
  try {
    const event: Partial<WebSocketEvent> = JSON.parse(data);
    if (
      !event || !event.stage || !ENGINE_STAGES.includes(event.stage) ||
      typeof event.message !== "string" || typeof event.timestamp !== "string" ||
      (event.file_content != null && typeof event.file_content !== "string") ||
      (event.payload != null && (typeof event.payload !== "object" || Array.isArray(event.payload)))
    ) return null;
    return event as WebSocketEvent;
  } catch {
    return null;
  }
}

function failure(message: string): Action {
  return {
    type: "event",
    event: { stage: "FAILURE", message, timestamp: new Date().toTimeString().slice(0, 8) },
  };
}

export function useEngineSocket() {
  const [state, dispatch] = useReducer(update, idle);
  const active = useRef<WebSocket | null>(null);

  useEffect(() => () => {
    const socket = active.current;
    active.current = null;
    socket?.close();
  }, []);

  const execute = useCallback((request: ExecuteRequest) => {
    if (active.current) return;
    dispatch({ type: "start" });

    let socket: WebSocket;
    try {
      socket = new WebSocket(engineSocketUrl());
    } catch {
      dispatch(failure("Could not open the engine connection. Check the backend URL."));
      return;
    }
    active.current = socket;

    function fail(message: string) {
      if (active.current !== socket) return;
      active.current = null;
      dispatch(failure(message));
      socket.close();
    }

    socket.onopen = () => {
      if (active.current !== socket) return;
      dispatch({ type: "connected" });
      try {
        socket.send(JSON.stringify(request));
      } catch {
        fail("Could not send the execution request. Check that the backend is running.");
      }
    };
    socket.onmessage = ({ data }) => {
      if (active.current !== socket) return;
      const event = parseEvent(data);
      if (!event) {
        fail("The engine sent an invalid execution event.");
        return;
      }
      dispatch({ type: "event", event });
      if (isTerminal(event.stage)) {
        active.current = null;
        socket.close(1000);
      }
    };
    socket.onerror = () => fail("Engine connection failed. Check that the backend is running.");
    socket.onclose = () => fail("The engine disconnected before reporting the result.");
  }, []);

  const clearLogs = useCallback(() => dispatch({ type: "clear" }), []);
  const runStatus = state.currentStage ? runStatuses[state.currentStage] : state.isExecuting ? "PLANNING" : "IDLE";
  return { ...state, execute, clearLogs, runStatus };
}
