import { EventEmitter } from 'node:events';
export interface RuntimeHealth { state: 'stopped' | 'starting' | 'ready' | 'error'; error?: string; generation: number }
export interface Model { provider: string; model: string; label: string }
export interface Session { id: string; title: string; workspacePath: string }
export class DshBackend extends EventEmitter {
  constructor(options: { dataDir: string; executable?: string });
  start(): Promise<RuntimeHealth>;
  health(): Promise<RuntimeHealth>;
  stop(): Promise<void>;
  restart(): Promise<RuntimeHealth>;
  getLogsPath(): Promise<string>;
  listModels(): Promise<Model[]>;
  configureProvider(config: { provider: string; api: string; baseURL: string; model: string; apiKey: string }): Promise<void>;
  listSessions(workspacePath: string): Promise<Session[]>;
  createSession(workspacePath: string, model?: Model): Promise<Session>;
  resumeSession(sessionId: string): Promise<unknown>;
  sendMessage(sessionId: string, message: string, model?: Model): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  respondApproval(sessionId: string, requestId: string, approved: boolean): Promise<void>;
}
