import type { Event } from "@zcode/rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface DshRuntimeHealth {
  state: "stopped" | "starting" | "ready" | "error";
  error?: string;
  generation: number;
}

export interface DshModel {
  provider: string;
  model: string;
  label: string;
}

export interface DshSession {
  id: string;
  title: string;
  workspacePath: string;
}

export interface DshProviderConfig {
  provider: string;
  api: "openai-completions" | "anthropic-messages";
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface DshEvent {
  sessionId: string;
  generation: number;
  type: string;
  data: unknown;
}

/** DSH owns accepted state. This service is only a transport and UI projection. */
export interface IDshService {
  readonly onEvent: Event<DshEvent>;
  start(): Promise<DshRuntimeHealth>;
  stop(): Promise<void>;
  restart(): Promise<DshRuntimeHealth>;
  health(): Promise<DshRuntimeHealth>;
  listModels(): Promise<DshModel[]>;
  configureProvider(config: DshProviderConfig): Promise<void>;
  listSessions(workspacePath: string): Promise<DshSession[]>;
  createSession(workspacePath: string, model?: DshModel): Promise<DshSession>;
  resumeSession(sessionId: string): Promise<unknown>;
  sendMessage(sessionId: string, message: string, model?: DshModel): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  respondApproval(sessionId: string, requestId: string, approved: boolean): Promise<void>;
  getLogsPath(): Promise<string>;
}

export const IDshService = createServiceDescriptor<IDshService>("dcode-dsh");
