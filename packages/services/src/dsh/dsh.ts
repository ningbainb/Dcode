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

export interface DshSubagentSettingsView {
  maxDepth: number;
  revision: number;
  writable: boolean;
}

export interface DshSession {
  id: string;
  title: string;
  workspacePath: string;
  source?: "zcode";
  updatedAt?: number;
}

export interface DshImportedZcodeSession extends DshSession {
  continuation: { omittedMessages: number; degradedAttachments: number };
  transcript: Array<{
    id: string;
    role: "user" | "assistant";
    createdAt: number;
    text: string;
    tools: Array<{
      id: string;
      name: string;
      status: string;
      title: string;
      input: string;
      output: string;
    }>;
  }>;
}

export interface DshZcodeImportCandidate {
  sourceId: string;
  title: string;
  workspacePath: string;
  updatedAt: number;
  messageCount: number;
  imported: boolean;
}

export interface DshZcodeImportResult {
  sourceId: string;
  status: "imported" | "skipped" | "failed";
  error?: string;
}

export interface DshProviderConfig {
  provider: string;
  api: "openai-completions" | "anthropic-messages";
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface DshProviderModelSettings {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input?: Array<"text" | "image">;
  reasoningEfforts?:
    | false
    | Partial<
        Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>
      >;
}

export interface DshProviderSettings {
  id: string;
  name: string;
  api: string;
  baseURL: string;
  models: DshProviderModelSettings[];
  hasApiKey: boolean;
  builtIn: boolean;
}

export interface DshProviderSettingsView {
  revision: number;
  writable: boolean;
  providers: DshProviderSettings[];
}

export type DshProviderDraft = Pick<
  DshProviderSettings,
  "id" | "name" | "api" | "baseURL" | "models"
> & {
  apiKey: string;
};

export interface DshAgentPluginStatus {
  browser: { enabled: boolean; available: boolean };
  windowsGui: { enabled: boolean; available: boolean; supported: boolean };
}

export type DshMcpServer =
  | {
      serverName: string;
      enabled: boolean;
      transport: "stdio";
      command: string;
      args: string[];
      cwd: string;
      envRefs: Record<string, string>;
    }
  | {
      serverName: string;
      enabled: boolean;
      transport: "streamable-http";
      url: string;
      bearerTokenEnv: string;
    };

export interface DshMcpServerSettingsView {
  revision: string;
  servers: DshMcpServer[];
}

export interface DshSessionAnnotation {
  id: string;
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  sourceText: string;
  selectedText: string;
  startOffset: number;
  comment: string;
  number: number;
  status: "pending" | "sent" | "resolved";
  createdAt: string;
  updatedAt: string;
}
export type DshSessionAnnotationInput = Pick<
  DshSessionAnnotation,
  "messageId" | "role" | "sourceText" | "selectedText" | "startOffset" | "comment"
>;

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
  listProviderSettings(): Promise<DshProviderSettingsView>;
  listSubagentSettings(): Promise<DshSubagentSettingsView>;
  updateSubagentSettings(
    maxDepth: number,
    expectedRevision: number,
  ): Promise<DshSubagentSettingsView>;
  saveProvider(
    draft: DshProviderDraft,
    expectedRevision: number,
    creating?: boolean,
  ): Promise<void>;
  deleteProvider(id: string, expectedRevision: number): Promise<void>;
  configureProvider(config: DshProviderConfig): Promise<void>;
  getAgentPlugins(): Promise<DshAgentPluginStatus>;
  listMcpServers(): Promise<DshMcpServerSettingsView>;
  updateMcpServers(
    servers: DshMcpServer[],
    expectedRevision: string,
  ): Promise<DshMcpServerSettingsView>;
  installWindowsGuiPlugin(): Promise<DshAgentPluginStatus>;
  setAgentPluginEnabled(
    id: "browser" | "windowsGui",
    enabled: boolean,
  ): Promise<DshAgentPluginStatus>;
  listSessions(workspacePath: string): Promise<DshSession[]>;
  listZcodeImportCandidates(): Promise<DshZcodeImportCandidate[]>;
  importZcodeSessions(sourceIds: string[]): Promise<DshZcodeImportResult[]>;
  readImportedZcodeSession(id: string): Promise<DshImportedZcodeSession>;
  continueImportedZcodeSession(id: string, workspacePath: string): Promise<DshSession>;
  createSession(workspacePath: string, model?: DshModel): Promise<DshSession>;
  resumeSession(sessionId: string): Promise<unknown>;
  listSessionAnnotations(sessionId: string): Promise<DshSessionAnnotation[]>;
  createSessionAnnotation(
    sessionId: string,
    input: DshSessionAnnotationInput,
  ): Promise<DshSessionAnnotation>;
  updateSessionAnnotation(
    sessionId: string,
    id: string,
    patch: Partial<Pick<DshSessionAnnotation, "comment" | "status">>,
  ): Promise<DshSessionAnnotation>;
  deleteSessionAnnotation(sessionId: string, id: string): Promise<boolean>;
  deleteMessageAnnotations(sessionId: string, messageId: string): Promise<number>;
  sendMessage(
    sessionId: string,
    message: string,
    model?: DshModel,
    annotationIds?: string[],
  ): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  respondApproval(sessionId: string, requestId: string, approved: boolean): Promise<void>;
  getLogsPath(): Promise<string>;
}

export const IDshService = createServiceDescriptor<IDshService>("dcode-dsh");
