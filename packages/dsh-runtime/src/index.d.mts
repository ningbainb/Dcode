import { EventEmitter } from "node:events";
export interface RuntimeHealth {
  state: "stopped" | "starting" | "ready" | "error";
  error?: string;
  generation: number;
}
export interface Model {
  provider: string;
  model: string;
  label: string;
}
export interface SubagentSettingsView {
  maxDepth: number;
  revision: number;
  writable: boolean;
}
export interface Session {
  id: string;
  title: string;
  workspacePath: string;
  source?: "zcode";
  updatedAt?: number;
}
export interface ZcodeImportCandidate {
  sourceId: string;
  title: string;
  workspacePath: string;
  updatedAt: number;
  messageCount: number;
  imported: boolean;
}
export interface ZcodeImportResult {
  sourceId: string;
  status: "imported" | "skipped" | "failed";
  error?: string;
}
export interface ImportedZcodeSession extends Session {
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
export interface AgentPluginStatus {
  browser: { enabled: boolean; available: boolean };
  windowsGui: { enabled: boolean; available: boolean; supported: boolean };
}
export type McpServer =
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
export interface McpServerSettingsView {
  revision: string;
  servers: McpServer[];
}
export interface SessionAnnotation {
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
export type SessionAnnotationInput = Pick<
  SessionAnnotation,
  "messageId" | "role" | "sourceText" | "selectedText" | "startOffset" | "comment"
>;
export class DshBackend extends EventEmitter {
  constructor(options: { dataDir: string; executable?: string; zcodeDbPath?: string });
  start(): Promise<RuntimeHealth>;
  health(): Promise<RuntimeHealth>;
  stop(): Promise<void>;
  restart(): Promise<RuntimeHealth>;
  getLogsPath(): Promise<string>;
  getAgentPlugins(): Promise<AgentPluginStatus>;
  listMcpServers(): Promise<McpServerSettingsView>;
  updateMcpServers(servers: McpServer[], expectedRevision: string): Promise<McpServerSettingsView>;
  installWindowsGuiPlugin(): Promise<AgentPluginStatus>;
  setAgentPluginEnabled(id: "browser" | "windowsGui", enabled: boolean): Promise<AgentPluginStatus>;
  listModels(): Promise<Model[]>;
  listSubagentSettings(): Promise<SubagentSettingsView>;
  updateSubagentSettings(maxDepth: number, expectedRevision: number): Promise<SubagentSettingsView>;
  listProviderSettings(): Promise<{
    revision: number;
    writable: boolean;
    providers: Array<{
      id: string;
      name: string;
      api: string;
      baseURL: string;
      models: Array<{ id: string; name: string; contextWindow: number; maxTokens: number }>;
      hasApiKey: boolean;
      builtIn: boolean;
    }>;
  }>;
  saveProvider(
    draft: {
      id: string;
      name: string;
      api: string;
      baseURL: string;
      apiKey: string;
      models: Array<{ id: string; name: string; contextWindow: number; maxTokens: number }>;
    },
    expectedRevision: number,
    creating?: boolean,
  ): Promise<void>;
  deleteProvider(id: string, expectedRevision: number): Promise<void>;
  configureProvider(config: {
    provider: string;
    api: string;
    baseURL: string;
    model: string;
    apiKey: string;
  }): Promise<void>;
  listSessions(workspacePath: string): Promise<Session[]>;
  listZcodeImportCandidates(): Promise<ZcodeImportCandidate[]>;
  importZcodeSessions(sourceIds: string[]): Promise<ZcodeImportResult[]>;
  readImportedZcodeSession(id: string): Promise<ImportedZcodeSession>;
  continueImportedZcodeSession(id: string, workspacePath: string): Promise<Session>;
  createSession(workspacePath: string, model?: Model): Promise<Session>;
  resumeSession(sessionId: string): Promise<unknown>;
  listSessionAnnotations(sessionId: string): Promise<SessionAnnotation[]>;
  createSessionAnnotation(
    sessionId: string,
    input: SessionAnnotationInput,
  ): Promise<SessionAnnotation>;
  updateSessionAnnotation(
    sessionId: string,
    id: string,
    patch: Partial<Pick<SessionAnnotation, "comment" | "status">>,
  ): Promise<SessionAnnotation>;
  deleteSessionAnnotation(sessionId: string, id: string): Promise<boolean>;
  deleteMessageAnnotations(sessionId: string, messageId: string): Promise<number>;
  sendMessage(
    sessionId: string,
    message: string,
    model?: Model,
    annotationIds?: string[],
  ): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  respondApproval(sessionId: string, requestId: string, approved: boolean): Promise<void>;
}
